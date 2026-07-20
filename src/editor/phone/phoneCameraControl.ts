import { useSyncExternalStore } from "react";
import {
  beginCameraDrivenCharacterAnimations,
  endCameraDrivenCharacterAnimations,
  reportCameraDrivenCharacterMovement,
} from "../animation/characterAnimation";
import {
  beginObjectAnimationsForCamera,
  endObjectAnimationsForCamera,
  reportCameraDrivenObjectMovement,
} from "../animation/objectAnimation";
import {
  beginAnimationSequenceRecording,
  endAnimationSequenceRecording,
  reportAnimationSequenceCameraMovement,
} from "../animation/animationSequence";
import { getCameraRigPositionFromViewSnapshot } from "../schema/cameraGeometry";
import type {
  DirectorCameraAnimation,
  DirectorCameraAnimationKeyframe,
  DirectorTransform,
} from "../schema/directorProject";
import { useDirectorStore } from "../store/directorStore";

export interface PhoneCameraState {
  cameraId?: string;
  phoneClientId?: string;
  position?: number[];
  yaw?: number;
  pitch?: number;
  roll?: number;
  fov?: number;
  recording?: boolean;
  recordingDuration?: number;
  updatedAt?: number;
}

type Tuple3 = [number, number, number];

const listeners = new Set<() => void>();
const pathByCameraId = new Map<string, Tuple3[]>();
const cameraIdByPhoneClientId = new Map<string, string>();
const phoneUpdateTimestampByCameraId = new Map<string, number>();
const lastPersistedPhoneUpdateByCameraId = new Map<string, number>();
let pathSnapshot: Tuple3[] = [];
const lastAppliedUpdateByPhoneClientId = new Map<string, number>();
const pendingPhoneStateByClientId = new Map<string, PhoneCameraState>();
let animationFrameId = 0;
let phoneFlushTimer = 0;
let activePlaybackId: number | null = null;
const VIDEO_FRAME_RATE = 60;
const LONG_RECORDING_FRAME_RATE = 30;
const VIDEO_CAPTURE_BIT_RATE = 6_000_000;
let cameraMonitorCanvas: HTMLCanvasElement | null = null;
type FrameRequestVideoTrack = MediaStreamTrack & { requestFrame?: () => void };
type LiveVideoCapture = {
  cameraId: string;
  chunks: BlobPart[];
  frameRate: number;
  frameRequestTrack: FrameRequestVideoTrack | null;
  nextFrameRequestAt: number;
  recorder: MediaRecorder;
  stream: MediaStream;
};
type RecordedVideo = {
  status: "capturing" | "processing" | "ready" | "failed";
  blob?: Blob;
  error?: string;
};
const recordingByCameraId = new Map<
  string,
  {
    startedAt: number;
    keyframes: DirectorCameraAnimationKeyframe[];
  }
>();
const liveVideoCapturesByCameraId = new Map<string, LiveVideoCapture>();
const requestedLiveVideoCameraIds = new Set<string>();
const requestedLiveVideoDurationByCameraId = new Map<string, number>();
const liveVideoCaptureErrorsByCameraId = new Map<string, string>();
const recordedVideoByAnimationId = new Map<string, RecordedVideo>();
const liveVideoListeners = new Set<() => void>();

function emitLiveVideoChange() {
  liveVideoListeners.forEach((listener) => listener());
}

export function subscribeLiveVideoRecording(listener: () => void) {
  liveVideoListeners.add(listener);
  return () => {
    liveVideoListeners.delete(listener);
  };
}

export function isLiveVideoCaptureActive() {
  return requestedLiveVideoCameraIds.size > 0 || liveVideoCapturesByCameraId.size > 0;
}

export function useLiveVideoCaptureActive() {
  return useSyncExternalStore(subscribeLiveVideoRecording, isLiveVideoCaptureActive, isLiveVideoCaptureActive);
}

export function getRecordedCameraVideoStatus(animationId: string) {
  return recordedVideoByAnimationId.get(animationId)?.status ?? "missing";
}

export function registerCameraMonitorCanvas(canvas: HTMLCanvasElement | null) {
  cameraMonitorCanvas = canvas;
}

export function unregisterCameraMonitorCanvas(canvas: HTMLCanvasElement | null) {
  if (cameraMonitorCanvas === canvas) cameraMonitorCanvas = null;
}

export function requestCameraMonitorVideoFrame(canvas: HTMLCanvasElement, now: number) {
  if (canvas !== cameraMonitorCanvas) return;
  liveVideoCapturesByCameraId.forEach((capture) => {
    if (!capture.frameRequestTrack || capture.recorder.state !== "recording") return;
    const frameInterval = 1000 / capture.frameRate;
    if (!capture.nextFrameRequestAt) capture.nextFrameRequestAt = now;
    if (now < capture.nextFrameRequestAt - 0.5) return;
    capture.frameRequestTrack.requestFrame?.();
    capture.nextFrameRequestAt += frameInterval;
    if (capture.nextFrameRequestAt < now) capture.nextFrameRequestAt = now + frameInterval;
  });
}

export function getVideoCaptureFrameRate(recordingDuration: number | undefined) {
  return typeof recordingDuration === "number" && recordingDuration > 5
    ? LONG_RECORDING_FRAME_RATE
    : VIDEO_FRAME_RATE;
}

export function removeRecordedCameraVideo(animationId: string) {
  recordedVideoByAnimationId.delete(animationId);
  emitLiveVideoChange();
}

function emit() {
  pathSnapshot = Array.from(pathByCameraId.values()).flat();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return pathSnapshot;
}

function toTuple3(value: unknown, fallback: Tuple3): Tuple3 {
  if (!Array.isArray(value)) return fallback;
  const next = value.slice(0, 3).map((item, index) => {
    const numberValue = typeof item === "number" && Number.isFinite(item) ? item : fallback[index];
    return Number(numberValue.toFixed(4));
  });
  while (next.length < 3) next.push(fallback[next.length]);
  return next as Tuple3;
}

function getLookAt(position: Tuple3, yaw = 0, pitch = 0): Tuple3 {
  const cosPitch = Math.cos(pitch);
  const direction: Tuple3 = [
    Math.sin(yaw) * cosPitch,
    Math.sin(pitch),
    -Math.cos(yaw) * cosPitch,
  ];
  return [
    Number((position[0] + direction[0] * 4).toFixed(4)),
    Number((position[1] + direction[1] * 4).toFixed(4)),
    Number((position[2] + direction[2] * 4).toFixed(4)),
  ];
}

function hasCamera(cameraId: string | undefined) {
  const store = useDirectorStore.getState();
  return Boolean(cameraId && store.project.cameras.some((camera) => camera.id === cameraId));
}

function getCameraOwner(cameraId: string) {
  return Array.from(cameraIdByPhoneClientId.entries()).find(([, assignedCameraId]) => assignedCameraId === cameraId)?.[0];
}

function isCameraAvailableForPhone(cameraId: string, phoneClientId: string) {
  const owner = getCameraOwner(cameraId);
  return !owner || owner === phoneClientId;
}

function ensureCamera(state: PhoneCameraState) {
  const store = useDirectorStore.getState();
  const phoneClientId = typeof state.phoneClientId === "string" ? state.phoneClientId : "";

  if (state.cameraId && hasCamera(state.cameraId) && (!phoneClientId || isCameraAvailableForPhone(state.cameraId, phoneClientId))) {
    if (phoneClientId) cameraIdByPhoneClientId.set(phoneClientId, state.cameraId);
    return state.cameraId as string;
  }

  const assignedCameraId = phoneClientId ? cameraIdByPhoneClientId.get(phoneClientId) : undefined;
  if (hasCamera(assignedCameraId)) return assignedCameraId as string;

  if (!phoneClientId && store.project.activeCameraId) return store.project.activeCameraId;

  const position = toTuple3(state.position, [0, 1.6, 5]);
  const fov = typeof state.fov === "number" && Number.isFinite(state.fov) ? state.fov : 35;
  const activeCameraId = store.project.activeCameraId;
  const cameraId = store.addCameraShot({ fov, position, target: getLookAt(position, state.yaw, state.pitch) });
  if (activeCameraId) store.setActiveCamera(activeCameraId);
  if (phoneClientId) cameraIdByPhoneClientId.set(phoneClientId, cameraId);
  return cameraId;
}

function appendPathPoint(cameraId: string, position: Tuple3) {
  const currentPath = pathByCameraId.get(cameraId) ?? [];
  const lastPoint = currentPath[currentPath.length - 1];
  const moved =
    !lastPoint ||
    Math.abs(lastPoint[0] - position[0]) > 0.02 ||
    Math.abs(lastPoint[1] - position[1]) > 0.02 ||
    Math.abs(lastPoint[2] - position[2]) > 0.02;

  if (!moved) return;
  pathByCameraId.set(cameraId, [...currentPath.slice(-399), position]);
  emit();
}

function finishCameraRecording(cameraId: string) {
  const recording = recordingByCameraId.get(cameraId);
  if (!recording) return null;
  let animationId: string | null = null;
  if (recording.keyframes.length >= 2) {
    const camera = useDirectorStore.getState().project.cameras.find((item) => item.id === cameraId);
      animationId = useDirectorStore.getState().addCameraAnimation({
        cameraId,
        name: `${camera?.name ?? "机位"}-手机轨迹`,
        keyframes: recording.keyframes,
      });
  }
  recordingByCameraId.delete(cameraId);
  removePhoneCameraPath(cameraId);
  return animationId;
}

function updateRecording(
  cameraId: string,
  keyframe: DirectorCameraAnimationKeyframe,
  recordingEnabled: boolean,
  recordingDuration?: number
) {
  if (!recordingEnabled) {
    const animationId = finishCameraRecording(cameraId);
    if (animationId) stopLiveVideoCapture(cameraId, animationId);
    else cancelLiveVideoCapture(cameraId);
    return;
  }

  let recording = recordingByCameraId.get(cameraId);
  if (!recording) {
    recording = {
      startedAt: keyframe.time,
      keyframes: [],
    };
    recordingByCameraId.set(cameraId, recording);
    removePhoneCameraPath(cameraId);
    requestLiveVideoCapture(cameraId, recordingDuration);
  }

  const normalizedTime = Number((keyframe.time - recording.startedAt).toFixed(2));
  const lastKeyframe = recording.keyframes[recording.keyframes.length - 1];
  if (lastKeyframe && normalizedTime - lastKeyframe.time < 1 / VIDEO_FRAME_RATE) return;

  recording.keyframes.push({
    ...keyframe,
    time: normalizedTime,
  });
}

function requestLiveVideoCapture(cameraId: string, recordingDuration?: number) {
  if (requestedLiveVideoCameraIds.has(cameraId)) return;
  requestedLiveVideoCameraIds.add(cameraId);
  requestedLiveVideoDurationByCameraId.set(cameraId, recordingDuration ?? 5);
  liveVideoCaptureErrorsByCameraId.delete(cameraId);
  emitLiveVideoChange();
  const store = useDirectorStore.getState();
  store.setPoseEditMode(false);
  store.setViewMode("director");
  store.setCameraMonitorCollapsed(false);
  store.setActiveCamera(cameraId);

  let attempts = 0;
  let readyFrames = 0;
  const waitForMonitor = () => {
    if (!requestedLiveVideoCameraIds.has(cameraId) || liveVideoCapturesByCameraId.has(cameraId)) return;
    const canvas = cameraMonitorCanvas;
    if (!canvas?.isConnected) {
      attempts += 1;
      readyFrames = 0;
      if (attempts < 180) {
        window.requestAnimationFrame(waitForMonitor);
      } else {
        requestedLiveVideoCameraIds.delete(cameraId);
        requestedLiveVideoDurationByCameraId.delete(cameraId);
        liveVideoCaptureErrorsByCameraId.set(cameraId, "机位监看画布启动超时，请重新录制。");
        emitLiveVideoChange();
      }
      return;
    }
    // Let the selected camera and animated scene finish a few monitor renders
    // before starting the encoder, so startup work is not captured as a freeze.
    if (readyFrames < 3) {
      readyFrames += 1;
      window.requestAnimationFrame(waitForMonitor);
      return;
    }
    startLiveVideoCapture(cameraId, canvas);
  };
  window.requestAnimationFrame(waitForMonitor);
}

function startLiveVideoCapture(cameraId: string, canvas: HTMLCanvasElement) {
  if (liveVideoCapturesByCameraId.has(cameraId) || !requestedLiveVideoCameraIds.has(cameraId)) return;
  if (!canvas?.captureStream || typeof MediaRecorder === "undefined") {
    requestedLiveVideoCameraIds.delete(cameraId);
    liveVideoCaptureErrorsByCameraId.set(cameraId, "当前浏览器不支持画布视频录制。");
    emitLiveVideoChange();
    return;
  }

  try {
    const frameRate = getVideoCaptureFrameRate(requestedLiveVideoDurationByCameraId.get(cameraId));
    let stream = canvas.captureStream(0);
    let videoTrack = stream.getVideoTracks()[0] as FrameRequestVideoTrack | undefined;
    let frameRequestTrack = typeof videoTrack?.requestFrame === "function" ? videoTrack : null;
    if (!frameRequestTrack) {
      stream.getTracks().forEach((track) => track.stop());
      stream = canvas.captureStream(frameRate);
      videoTrack = stream.getVideoTracks()[0] as FrameRequestVideoTrack | undefined;
    }
    if (!videoTrack) throw new Error("机位监看没有可录制的视频轨道");
    videoTrack.contentHint = "motion";
    const recorder = createVideoRecorder(stream);
    const capture: LiveVideoCapture = {
      cameraId,
      chunks: [],
      frameRate,
      frameRequestTrack,
      nextFrameRequestAt: 0,
      recorder,
      stream,
    };
    liveVideoCapturesByCameraId.set(cameraId, capture);
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) capture.chunks.push(event.data);
    });
    // Flush once per second so 10/15-second recordings do not build one growing
    // encoder buffer. This is infrequent enough to stay off the render hot path.
    recorder.start(1000);
    const project = useDirectorStore.getState().project;
    beginAnimationSequenceRecording(
      cameraId,
      project.animationSequences ?? [],
      project.activeAnimationSequenceId,
      { restart: true }
    );
    emitLiveVideoChange();
  } catch (error) {
    requestedLiveVideoCameraIds.delete(cameraId);
    requestedLiveVideoDurationByCameraId.delete(cameraId);
    liveVideoCaptureErrorsByCameraId.set(
      cameraId,
      error instanceof Error ? error.message : "无法启动机位视频录制"
    );
    emitLiveVideoChange();
  }
}

function cancelLiveVideoCapture(cameraId: string) {
  requestedLiveVideoCameraIds.delete(cameraId);
  requestedLiveVideoDurationByCameraId.delete(cameraId);
  const capture = liveVideoCapturesByCameraId.get(cameraId);
  if (capture && capture.recorder.state !== "inactive") capture.recorder.stop();
  capture?.stream.getTracks().forEach((track) => track.stop());
  liveVideoCapturesByCameraId.delete(cameraId);
  emitLiveVideoChange();
}

function stopLiveVideoCapture(cameraId: string, animationId: string) {
  requestedLiveVideoCameraIds.delete(cameraId);
  requestedLiveVideoDurationByCameraId.delete(cameraId);
  const capture = liveVideoCapturesByCameraId.get(cameraId);
  emitLiveVideoChange();
  if (!capture) {
    recordedVideoByAnimationId.set(animationId, {
      status: "failed",
      error: liveVideoCaptureErrorsByCameraId.get(cameraId) ?? "机位监看尚未准备完成，未能保存本次原始视频。",
    });
    liveVideoCaptureErrorsByCameraId.delete(cameraId);
    emitLiveVideoChange();
    return;
  }

  recordedVideoByAnimationId.set(animationId, { status: "processing" });
  emitLiveVideoChange();
  const finishCapture = () => {
    capture.stream.getTracks().forEach((track) => track.stop());
    liveVideoCapturesByCameraId.delete(cameraId);
    liveVideoCaptureErrorsByCameraId.delete(cameraId);
    const source = new Blob(capture.chunks, { type: capture.recorder.mimeType || "video/webm" });
    if (!source.size) {
      recordedVideoByAnimationId.set(animationId, { status: "failed", error: "录制画布没有产生视频帧，请重新录制。" });
      emitLiveVideoChange();
      return;
    }
    void convertVideoToMp4(source, capture.frameRate)
      .then((blob) => {
        recordedVideoByAnimationId.set(animationId, { status: "ready", blob });
        emitLiveVideoChange();
      })
      .catch((error) => {
        recordedVideoByAnimationId.set(animationId, {
          status: "failed",
          error: error instanceof Error ? error.message : "录制视频封装失败",
        });
        emitLiveVideoChange();
      });
  };
  if (capture.recorder.state === "inactive") {
    finishCapture();
    return;
  }
  capture.recorder.addEventListener("stop", finishCapture, { once: true });
  if (capture.recorder.state === "recording") capture.recorder.requestData();
  capture.recorder.stop();
}

function downloadVideo(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name || "camera-animation"}.mp4`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getCameraDrivenCharacterIds(cameraId: string) {
  return useDirectorStore
    .getState()
    .project.objects.filter(
      (object) =>
        object.kind === "character" &&
        object.characterActionTrack?.enabled &&
        object.characterActionTrack.playbackMode === "camera-driven" &&
        (!object.characterActionTrack.cameraId || object.characterActionTrack.cameraId === cameraId)
    )
    .map((object) => object.id);
}

function applyPhoneCameraState(state: PhoneCameraState) {
  const updatedAt = typeof state.updatedAt === "number" ? state.updatedAt : Date.now();
  const phoneClientId = typeof state.phoneClientId === "string" ? state.phoneClientId : "legacy-phone";
  const lastAppliedUpdate = lastAppliedUpdateByPhoneClientId.get(phoneClientId) ?? 0;
  if (updatedAt <= lastAppliedUpdate) return;
  lastAppliedUpdateByPhoneClientId.set(phoneClientId, updatedAt);

  const cameraId = ensureCamera(state);
  const activeCamera = useDirectorStore.getState().project.cameras.find((camera) => camera.id === cameraId);
  const fallbackPosition = activeCamera?.transform.position ?? [0, 1.6, 5];
  const position = toTuple3(state.position, fallbackPosition);
  const target = getLookAt(position, state.yaw, state.pitch);
  const fov = typeof state.fov === "number" && Number.isFinite(state.fov) ? state.fov : activeCamera?.fov ?? 35;
  const transform: DirectorTransform = {
    position: getCameraRigPositionFromViewSnapshot({ fov, position, target }),
    rotation: [state.pitch ?? 0, state.yaw ?? 0, state.roll ?? 0],
    scale: [1, 1, 1],
  };

  const patch = {
    fov,
    targetMode: "manual" as const,
    targetObjectId: null,
    target,
    transform,
  };
  useDirectorStore.getState().updateCameraForPlayback(cameraId, patch);
  const lastPersisted = lastPersistedPhoneUpdateByCameraId.get(cameraId) ?? 0;
  if (!state.recording && updatedAt - lastPersisted >= 750) {
    lastPersistedPhoneUpdateByCameraId.set(cameraId, updatedAt);
    useDirectorStore.getState().updateCamera(cameraId, patch);
  }
  phoneUpdateTimestampByCameraId.set(cameraId, updatedAt);
  if (state.recording) {
    const project = useDirectorStore.getState().project;
    beginAnimationSequenceRecording(cameraId, project.animationSequences ?? [], project.activeAnimationSequenceId);
    beginCameraDrivenCharacterAnimations(cameraId, getCameraDrivenCharacterIds(cameraId));
    beginObjectAnimationsForCamera(cameraId, useDirectorStore.getState().project.objects);
    reportCameraDrivenCharacterMovement(cameraId, { position, target, fov, time: updatedAt });
    reportCameraDrivenObjectMovement(cameraId, { position, target, fov, time: updatedAt });
    reportAnimationSequenceCameraMovement(cameraId, { position, target, fov, time: updatedAt });
    appendPathPoint(cameraId, position);
  } else {
    endAnimationSequenceRecording(cameraId);
    endCameraDrivenCharacterAnimations(cameraId);
    endObjectAnimationsForCamera(cameraId);
  }
  updateRecording(
    cameraId,
    {
      time: updatedAt / 1000,
      position,
      target,
      fov,
    },
    Boolean(state.recording),
    state.recordingDuration
  );
  if (!state.recording) removePhoneCameraPath(cameraId);
}

function flushPendingPhoneState() {
  if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
  animationFrameId = 0;
  if (phoneFlushTimer) window.clearTimeout(phoneFlushTimer);
  phoneFlushTimer = 0;
  const states = Array.from(pendingPhoneStateByClientId.values());
  pendingPhoneStateByClientId.clear();
  states.forEach(applyPhoneCameraState);
}

export function queuePhoneCameraState(state: PhoneCameraState) {
  const phoneClientId = typeof state.phoneClientId === "string" ? state.phoneClientId : "legacy-phone";
  pendingPhoneStateByClientId.set(phoneClientId, state);
  if (!animationFrameId) {
    animationFrameId = window.requestAnimationFrame(flushPendingPhoneState);
  }
  if (!phoneFlushTimer) {
    phoneFlushTimer = window.setTimeout(flushPendingPhoneState, 40);
  }
}

export function usePhoneCameraPath() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getPhoneCameraAssignments() {
  const cameraIds = new Set(useDirectorStore.getState().project.cameras.map((camera) => camera.id));
  return Object.fromEntries(
    Array.from(cameraIdByPhoneClientId.entries()).filter(([, cameraId]) => cameraIds.has(cameraId))
  );
}

export function getPhoneCameraOwners() {
  return Object.fromEntries(
    Object.entries(getPhoneCameraAssignments()).map(([phoneClientId, cameraId]) => [cameraId, phoneClientId])
  );
}

export function getPhoneCameraUpdateTimestamp(cameraId: string) {
  return phoneUpdateTimestampByCameraId.get(cameraId);
}

export function releasePhoneCamera(phoneClientId: string) {
  if (!phoneClientId) return;
  cameraIdByPhoneClientId.delete(phoneClientId);
  lastAppliedUpdateByPhoneClientId.delete(phoneClientId);
  pendingPhoneStateByClientId.delete(phoneClientId);
}

export function clearPhoneCameraPath() {
  pathByCameraId.clear();
  emit();
}

export function removePhoneCameraPath(cameraId: string) {
  pathByCameraId.delete(cameraId);
  emit();
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpTuple(a: Tuple3, b: Tuple3, t: number): Tuple3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)].map((value) =>
    Number(value.toFixed(4))
  ) as Tuple3;
}

export function playCameraAnimation(animation: DirectorCameraAnimation) {
  if (activePlaybackId) {
    window.cancelAnimationFrame(activePlaybackId);
    activePlaybackId = null;
  }

  const keyframes = animation.keyframes;
  if (keyframes.length < 2) return 0;

  const startedAt = performance.now();
  const duration = Math.max(keyframes[keyframes.length - 1].time, 1);
  const playbackDuration = getCameraAnimationPlaybackDuration(animation);
  useDirectorStore.getState().setActiveCamera(animation.cameraId);
  beginCameraDrivenCharacterAnimations(animation.cameraId, getCameraDrivenCharacterIds(animation.cameraId));
  beginObjectAnimationsForCamera(animation.cameraId, useDirectorStore.getState().project.objects);
  beginAnimationSequenceRecording(
    animation.cameraId,
    useDirectorStore.getState().project.animationSequences ?? [],
    useDirectorStore.getState().project.activeAnimationSequenceId
  );

  function tick(now: number) {
    const playbackElapsed = Math.min(now - startedAt, playbackDuration);
    const elapsed = Math.min((playbackElapsed / playbackDuration) * duration, duration);
    let previous = keyframes[0];
    let next = keyframes[keyframes.length - 1];

    for (let index = 1; index < keyframes.length; index += 1) {
      if (keyframes[index].time >= elapsed) {
        previous = keyframes[index - 1];
        next = keyframes[index];
        break;
      }
    }

    const span = Math.max(next.time - previous.time, 1);
    const t = Math.min(Math.max((elapsed - previous.time) / span, 0), 1);
    const position = lerpTuple(previous.position, next.position, t);
    const target = lerpTuple(previous.target, next.target, t);
    const fov = Number(lerp(previous.fov, next.fov, t).toFixed(3));
    const transform: DirectorTransform = {
      position: getCameraRigPositionFromViewSnapshot({ fov, position, target }),
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };

    useDirectorStore.getState().updateCameraForPlayback(animation.cameraId, {
      fov,
      targetMode: "manual",
      targetObjectId: null,
      target,
      transform,
    });
    reportCameraDrivenCharacterMovement(animation.cameraId, { position, target, fov, time: now });
    reportCameraDrivenObjectMovement(animation.cameraId, { position, target, fov, time: now });
    reportAnimationSequenceCameraMovement(animation.cameraId, { position, target, fov, time: now });
    if (playbackElapsed < playbackDuration) {
      activePlaybackId = window.requestAnimationFrame(tick);
    } else {
      activePlaybackId = null;
      endCameraDrivenCharacterAnimations(animation.cameraId);
      endObjectAnimationsForCamera(animation.cameraId);
      endAnimationSequenceRecording(animation.cameraId);
      useDirectorStore.getState().saveLatestSnapshot();
    }
  }

  activePlaybackId = window.requestAnimationFrame(tick);
  return playbackDuration;
}

export function getCameraAnimationPlaybackDuration(animation: DirectorCameraAnimation) {
  const keyframes = animation.keyframes;
  if (keyframes.length < 2) return 0;
  return Math.max(Math.max(keyframes[keyframes.length - 1].time, 1), 1200);
}

function createVideoRecorder(stream: MediaStream) {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E",
    "video/webm;codecs=vp8",
    "video/webm;codecs=vp9",
    "video/webm",
    "video/mp4",
  ];
  for (const mimeType of candidates) {
    if (!MediaRecorder.isTypeSupported(mimeType)) continue;
    try {
      return new MediaRecorder(stream, { mimeType, videoBitsPerSecond: VIDEO_CAPTURE_BIT_RATE });
    } catch {
      // Try the next supported codec when the platform cannot initialize this encoder.
    }
  }
  return new MediaRecorder(stream, { videoBitsPerSecond: VIDEO_CAPTURE_BIT_RATE });
}

async function convertVideoToMp4(video: Blob, captureFrameRate: number) {
  const response = await fetch("/api/video/convert", {
    method: "POST",
    headers: {
      "content-type": video.type || "video/webm",
      "x-capture-frame-rate": String(captureFrameRate),
    },
    body: video,
  });
  if (!response.ok) {
    let message = "MP4 转码失败";
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) message = `MP4 转码失败：${payload.error}`;
    } catch {
      // Keep the generic conversion error when the server cannot return JSON.
    }
    throw new Error(message);
  }
  return response.blob();
}

export async function exportCameraAnimationVideo(animation: DirectorCameraAnimation) {
  const recordedVideo = recordedVideoByAnimationId.get(animation.id);
  if (recordedVideo?.status === "ready" && recordedVideo.blob) {
    downloadVideo(recordedVideo.blob, animation.name);
    return;
  }
  if (recordedVideo?.status === "capturing" || recordedVideo?.status === "processing") {
    throw new Error("这段视频正在封装为 MP4，请稍候再导出。");
  }
  throw new Error(recordedVideo?.error || "本次没有保存到原始机位视频，请重新录制。");
}
