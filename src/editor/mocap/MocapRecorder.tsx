import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, CircleDot, RotateCcw, Square, Video } from "lucide-react";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { CharacterActionTrack, DirectorObject } from "../schema/directorProject";
import { playNormalCharacterAnimations } from "../animation/characterAnimation";
import { useDirectorStore } from "../store/directorStore";
import {
  applyPoseCalibration,
  hasUsableUpperBodyPose,
  mapPoseLandmarksToControls,
  type PoseLandmarkSample,
  type PoseCalibration,
} from "./poseMapping";

type Duration = 5 | 10 | 15;

const MODEL_PATH = "/mediapipe/pose_landmarker_full.task";
const WASM_PATH = "/mediapipe/wasm";
const SKELETON_CONNECTIONS: Array<[number, number]> = [
  [0, 11], [0, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
];

async function createLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  const options = {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" as const },
    runningMode: "VIDEO" as const,
    numPoses: 1,
    minPoseDetectionConfidence: 0.55,
    minPosePresenceConfidence: 0.55,
    minTrackingConfidence: 0.55,
  };

  try {
    return await PoseLandmarker.createFromOptions(fileset, options);
  } catch {
    return PoseLandmarker.createFromOptions(fileset, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: "CPU" },
    });
  }
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), milliseconds);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

export function MocapRecorder({ character, crowdId }: { character: DirectorObject; crowdId?: string | null }) {
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState<Duration>(5);
  const [status, setStatus] = useState("打开本地摄像头后进行中立姿势校准");
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [calibration, setCalibration] = useState<PoseCalibration | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const objects = useDirectorStore((state) => state.project.objects);
  const characters = useMemo(
    () => objects.filter((object) => object.kind === "character" && object.characterRig?.rigType === "ue4-mannequin" && !object.assetRefId),
    [objects]
  );
  const [targetCharacterId, setTargetCharacterId] = useState(character.id);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const frameRef = useRef(0);
  const controlsRef = useRef<Record<string, number>>({});
  const recordingRef = useRef(false);
  const pendingRecordingRef = useRef(false);
  const startedAtRef = useRef(0);
  const lastSampleAtRef = useRef(0);
  const lastDetectAtRef = useRef(0);
  const framesRef = useRef<Array<{ time: number; controls: Record<string, number> }>>([]);
  const calibrationRef = useRef<PoseCalibration | null>(null);
  const durationRef = useRef<Duration>(5);
  const targetCharacter = useMemo(
    () => characters.find((candidate) => candidate.id === targetCharacterId) ?? character,
    [character, characters, targetCharacterId]
  );

  useEffect(() => {
    setTargetCharacterId((current) => (characters.some((candidate) => candidate.id === current) ? current : character.id));
  }, [character.id, characters]);

  function stopCamera() {
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    const context = overlayRef.current?.getContext("2d");
    if (context && overlayRef.current) context.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
    setReady(false);
  }

  function drawSkeleton(landmarks: PoseLandmarkSample[] | undefined) {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const pixelRatio = window.devicePixelRatio || 1;
    const targetWidth = Math.max(1, Math.round(width * pixelRatio));
    const targetHeight = Math.max(1, Math.round(height * pixelRatio));
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, targetWidth, targetHeight);
    if (!landmarks?.length) return;
    const point = (index: number) => {
      const landmark = landmarks[index];
      return landmark && (landmark.visibility ?? 1) >= 0.35
        ? { x: (1 - landmark.x) * targetWidth, y: landmark.y * targetHeight }
        : null;
    };
    context.lineWidth = Math.max(2, pixelRatio * 2);
    context.strokeStyle = "rgba(23, 195, 255, 0.92)";
    SKELETON_CONNECTIONS.forEach(([start, end]) => {
      const first = point(start);
      const second = point(end);
      if (!first || !second) return;
      context.beginPath();
      context.moveTo(first.x, first.y);
      context.lineTo(second.x, second.y);
      context.stroke();
    });
    context.fillStyle = "rgba(255, 209, 102, 0.98)";
    landmarks.forEach((_, index) => {
      const current = point(index);
      if (!current) return;
      context.beginPath();
      context.arc(current.x, current.y, Math.max(2.5, pixelRatio * 2.2), 0, Math.PI * 2);
      context.fill();
    });
  }

  function saveClip() {
    const frames = framesRef.current;
    recordingRef.current = false;
    setRecording(false);
    if (frames.length < 2) {
      setStatus("未捕捉到足够的身体关键点，请调整站位后重试");
      return;
    }
    const clipDuration = Math.max(frames[frames.length - 1].time, 0.1);
    const store = useDirectorStore.getState();
    const clipId = store.addCharacterMotionClip({
      characterId: targetCharacter.id,
      name: `${targetCharacter.name}-摄像头动捕`,
      duration: clipDuration,
      frames,
    });
    const track: CharacterActionTrack = {
      actionId: "idle",
      duration: Math.max(durationRef.current, 5),
      loop: false,
      playbackMode: "normal",
      cameraId: null,
      enabled: true,
      source: "mocap",
      motionClipId: clipId,
    };
    if (crowdId && targetCharacter.id === character.id) store.setCrowdCharacterActionTrack(crowdId, track);
    else store.setCharacterActionTrack(targetCharacter.id, track);
    const updatedStore = useDirectorStore.getState();
    playNormalCharacterAnimations(
      updatedStore.project.objects
        .filter((item) => item.kind === "character" && item.characterActionTrack?.enabled && item.characterActionTrack.playbackMode === "normal")
        .map((item) => item.id)
    );
    setStatus(`已保存给 ${targetCharacter.name} · ${Math.round(clipDuration * 10) / 10} 秒动捕动作`);
  }

  function detectFrame(now: number) {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    if (video && landmarker && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && now - lastDetectAtRef.current >= 1000 / 15) {
      lastDetectAtRef.current = now;
      const result = landmarker.detectForVideo(video, now);
      const landmarks = result.worldLandmarks[0] as PoseLandmarkSample[] | undefined;
      drawSkeleton(result.landmarks[0] as PoseLandmarkSample[] | undefined);
      if (hasUsableUpperBodyPose(landmarks)) {
        const rawControls = mapPoseLandmarksToControls(landmarks as PoseLandmarkSample[]);
        let controls = applyPoseCalibration(rawControls, calibrationRef.current);
        if (pendingRecordingRef.current && !recordingRef.current) {
          calibrationRef.current = { ...rawControls };
          setCalibration({ ...rawControls });
          pendingRecordingRef.current = false;
          controls = applyPoseCalibration(rawControls, calibrationRef.current);
          beginRecording();
        }
        controlsRef.current = controls;
        if (recordingRef.current) {
          const seconds = (now - startedAtRef.current) / 1000;
          if (seconds - lastSampleAtRef.current >= 1 / 30) {
            lastSampleAtRef.current = seconds;
            framesRef.current.push({ time: Number(seconds.toFixed(3)), controls });
            setElapsed(seconds);
          }
          if (seconds >= durationRef.current) saveClip();
        }
      } else if (recordingRef.current) {
        setStatus("正在录制，未检测到身体关键点，请保持上半身在画面内");
      }
    }
    frameRef.current = window.requestAnimationFrame(detectFrame);
  }

  async function openCamera() {
    if (ready) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("当前浏览器无法访问电脑摄像头");
      return;
    }
    try {
      setStatus("正在启动本地摄像头和姿势识别");
      const stream = await withTimeout(
        navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 720 },
            height: { ideal: 1280 },
            aspectRatio: { ideal: 9 / 16 },
            resizeMode: "none",
          } as MediaTrackConstraints,
          audio: false,
        }),
        8000,
        "摄像头权限请求超时"
      );
      streamRef.current = stream;
      const landmarker = await withTimeout(createLandmarker(), 12000, "本地姿势模型加载超时");
      landmarkerRef.current = landmarker;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setReady(true);
      setStatus("请面向摄像头站立，完整身体或上半身均可录制");
      frameRef.current = window.requestAnimationFrame(detectFrame);
    } catch (error) {
      stopCamera();
      setStatus(error instanceof Error ? `无法启动摄像头：${error.message}` : "无法启动摄像头");
    }
  }

  function calibrate() {
    const controls = controlsRef.current;
    if (!Object.keys(controls).length) {
      setStatus("尚未检测到身体关键点，无法校准");
      return;
    }
    calibrationRef.current = { ...controls };
    setCalibration({ ...controls });
    setStatus("中立姿势已校准，可以开始录制");
  }

  function beginRecording() {
    framesRef.current = [];
    startedAtRef.current = performance.now();
    lastSampleAtRef.current = -1;
    lastDetectAtRef.current = 0;
    recordingRef.current = true;
    setElapsed(0);
    setRecording(true);
    setStatus(`正在录制 ${duration} 秒动作，目标：${targetCharacter.name}`);
  }

  function startRecording() {
    if (!ready || recording) {
      if (!ready) setStatus("请先打开本地摄像头");
      return;
    }
    if (!calibrationRef.current) {
      const controls = controlsRef.current;
      if (!Object.keys(controls).length) {
        pendingRecordingRef.current = true;
        setStatus("等待检测到身体关键点后自动开始录制");
        return;
      }
      calibrationRef.current = { ...controls };
      setCalibration({ ...controls });
      setStatus("已自动校准中立姿势，开始录制");
    }
    beginRecording();
  }

  useEffect(
    () => () => {
      recordingRef.current = false;
      pendingRecordingRef.current = false;
      stopCamera();
    },
    []
  );

  if (!open) {
    return (
      <button className="mocap-launch" type="button" aria-label="打开摄像头动捕" title="摄像头动捕" onClick={() => setOpen(true)}>
        <Video aria-hidden="true" size={16} />
        摄像头动捕
      </button>
    );
  }

  return (
    <section className="mocap-recorder" aria-label="本地摄像头动捕">
      <div className="mocap-recorder-header">
        <div>
          <strong>本地全身动捕</strong>
          <span>目标：{targetCharacter.name}</span>
        </div>
        <button type="button" aria-label="关闭摄像头动捕" onClick={() => { stopCamera(); setOpen(false); }}>
          ×
        </button>
      </div>
      <div className="mocap-preview-stage">
        <video ref={videoRef} className="mocap-video" muted playsInline />
        <canvas ref={overlayRef} className="mocap-skeleton" aria-hidden="true" />
      </div>
      <p>{status}</p>
      <label className="mocap-target-role">
        录制给角色
        <select value={targetCharacter.id} disabled={recording} onChange={(event) => setTargetCharacterId(event.currentTarget.value)}>
          {characters.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
        </select>
      </label>
      <div className="mocap-duration" role="group" aria-label="动捕录制时长">
        {[5, 10, 15].map((value) => (
          <button key={value} className={duration === value ? "is-active" : undefined} type="button" onClick={() => { durationRef.current = value as Duration; setDuration(value as Duration); }}>
            {value}秒
          </button>
        ))}
      </div>
      <div className="mocap-actions">
        <button type="button" onClick={() => void openCamera()} disabled={ready}>
          <Camera aria-hidden="true" size={16} />
          {ready ? "摄像头已打开" : "打开摄像头"}
        </button>
        <button type="button" onClick={calibrate} disabled={!ready}>
          <RotateCcw aria-hidden="true" size={16} />
          校准
        </button>
        <button type="button" className={recording ? "is-recording" : undefined} onClick={recording ? saveClip : startRecording} disabled={!ready}>
          {recording ? <Square aria-hidden="true" size={16} /> : <CircleDot aria-hidden="true" size={16} />}
          {recording ? `停止 ${elapsed.toFixed(1)}秒` : `录制${duration}秒`}
        </button>
      </div>
      <small>摄像头画面和人体关键点仅在本机浏览器中处理，不会上传或保存视频。</small>
    </section>
  );
}
