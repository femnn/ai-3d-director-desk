import { executeDirectorAgentTool } from "../agent/directorAgent";
import { getCharacterAnimationElapsedSnapshot, subscribeCharacterAnimationRuntime } from "../animation/characterAnimation";
import { getObjectAnimationElapsedSnapshot } from "../animation/objectAnimation";
import {
  getAnimationSequenceRuntimeSnapshot,
  subscribeAnimationSequenceRuntime,
} from "../animation/animationSequence";
import {
  getPhoneCameraAssignments,
  getPhoneCameraOwners,
  getPhoneCameraUpdateTimestamp,
  queuePhoneCameraState,
  releasePhoneCamera,
} from "../phone/phoneCameraControl";
import { getPhoneMocapAssignments, handlePhoneMocapState, releasePhoneMocap } from "../mocap/phoneMocapControl";
import { handlePhonePoseState, releasePhonePose } from "../mocap/phonePoseControl";
import { getCameraViewSnapshotFromShot } from "../schema/cameraGeometry";
import type { DirectorProject } from "../schema/directorProject";
import { useDirectorStore } from "../store/directorStore";

let phonePreviewRevision = 0;
const phonePreviewSessionId =
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
let phonePreviewProject: DirectorProject | null = null;
let phonePreviewPending = false;
let phonePreviewError: string | null = null;
let phonePreviewBuildId = 0;
let requestPhonePreviewBroadcast: (() => void) | null = null;
const phonePreviewAssetSignatures = new Map<string, string>();
let phonePreviewFingerprint: string | null = null;
let lastSentPhonePreviewRevision = -1;

export function createPhonePreviewProject(project: DirectorProject): DirectorProject {
  const objects = project.objects.filter((object) => object.kind !== "camera");
  const usedAssetIds = new Set(
    objects
      .map((object) => object.assetRefId)
      .filter((assetId): assetId is string => typeof assetId === "string")
  );
  if (project.panoramaAssetId) usedAssetIds.add(project.panoramaAssetId);

  return {
    version: 1,
    scene: project.scene,
    assets: project.assets.filter((asset) => usedAssetIds.has(asset.id)),
    objects,
    cameras: [],
    cameraAnimations: [],
    characterMotionClips: project.characterMotionClips ?? [],
    characterFaceClips: project.characterFaceClips ?? [],
    animationSequences: project.animationSequences ?? [],
    activeAnimationSequenceId: project.activeAnimationSequenceId ?? null,
    activeCameraId: null,
    panoramaAssetId: project.panoramaAssetId,
  };
}

function createImmediatePhonePreviewProject(project: DirectorProject): DirectorProject {
  const preview = createPhonePreviewProject(project);
  const assets = preview.assets.filter((asset) => !asset.url.startsWith("data:"));
  const usableAssetIds = new Set(assets.map((asset) => asset.id));

  return {
    ...preview,
    assets,
    panoramaAssetId: usableAssetIds.has(preview.panoramaAssetId ?? "") ? preview.panoramaAssetId : null,
    objects: preview.objects
      .filter((object) => !object.assetRefId || usableAssetIds.has(object.assetRefId) || object.kind === "character")
      .map((object) =>
        object.assetRefId && !usableAssetIds.has(object.assetRefId) && object.kind === "character"
          ? { ...object, assetRefId: undefined }
          : object
      ),
  };
}

export function getPhonePreviewFingerprint(project: DirectorProject) {
  const preview = createPhonePreviewProject(project);
  return JSON.stringify({
    scene: preview.scene,
    panoramaAssetId: preview.panoramaAssetId,
    assets: preview.assets.map((asset) => [
      asset.id,
      asset.fileName,
      asset.sourceType,
      asset.animated,
      asset.url.length,
      asset.url.slice(-64),
    ]),
    objects: preview.objects,
    animationSequences: preview.animationSequences,
    characterMotionClips: (preview.characterMotionClips ?? []).map((clip) => [clip.id, clip.characterId, clip.duration, clip.frames.length]),
    characterFaceClips: (preview.characterFaceClips ?? []).map((clip) => [clip.id, clip.characterId, clip.checksum, clip.frames.length]),
    activeAnimationSequenceId: preview.activeAnimationSequenceId,
  });
}

async function publishPhonePreviewAsset(asset: DirectorProject["assets"][number]) {
  if (!asset.url.startsWith("data:")) return asset;

  const signature = `${asset.id}:${asset.url.length}:${asset.url.slice(-64)}`;
  if (phonePreviewAssetSignatures.get(asset.id) !== signature) {
    const source = await fetch(asset.url);
    if (!source.ok) throw new Error(`${asset.name ?? asset.fileName} 无法读取`);
    const upload = await fetch(`/api/phone-assets/${encodeURIComponent(asset.id)}`, {
      method: "POST",
      headers: { "content-type": source.headers.get("content-type") ?? "application/octet-stream" },
      body: await source.blob(),
    });
    if (!upload.ok) throw new Error(`${asset.name ?? asset.fileName} 无法同步到手机`);
    phonePreviewAssetSignatures.set(asset.id, signature);
  }

  return { ...asset, url: `/api/phone-assets/${encodeURIComponent(asset.id)}` };
}

async function publishPhonePreviewProject(project: DirectorProject) {
  const preview = createPhonePreviewProject(project);
  const settledAssets = await Promise.allSettled(preview.assets.map(publishPhonePreviewAsset));
  const assets = settledAssets.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const usableAssetIds = new Set(assets.map((asset) => asset.id));

  return {
    ...preview,
    assets,
    panoramaAssetId: usableAssetIds.has(preview.panoramaAssetId ?? "") ? preview.panoramaAssetId : null,
    objects: preview.objects
      .filter((object) => !object.assetRefId || usableAssetIds.has(object.assetRefId) || object.kind === "character")
      .map((object) =>
        object.assetRefId && !usableAssetIds.has(object.assetRefId) && object.kind === "character"
          ? { ...object, assetRefId: undefined }
          : object
      ),
  };
}

function getPhonePreviewUpdate(project: DirectorProject) {
  const fingerprint = getPhonePreviewFingerprint(project);
  const sourceChanged = fingerprint !== phonePreviewFingerprint;

  if (!sourceChanged) {
    return {
      phonePreviewRevision,
      phonePreviewProject,
      phonePreviewPending,
      phonePreviewError,
    };
  }

  phonePreviewFingerprint = fingerprint;
  phonePreviewPending = true;
  phonePreviewError = null;
  phonePreviewProject = createImmediatePhonePreviewProject(project);
  phonePreviewRevision += 1;
  const buildId = ++phonePreviewBuildId;

  void publishPhonePreviewProject(project)
    .then((preview) => {
      if (buildId !== phonePreviewBuildId) return;
      phonePreviewProject = preview;
      phonePreviewRevision += 1;
      phonePreviewPending = false;
      requestPhonePreviewBroadcast?.();
    })
    .catch((error) => {
      if (buildId !== phonePreviewBuildId) return;
      phonePreviewPending = false;
      phonePreviewError = error instanceof Error ? error.message : "部分场景资源未同步";
      requestPhonePreviewBroadcast?.();
    });

  return { phonePreviewRevision, phonePreviewProject, phonePreviewPending, phonePreviewError };
}

export function createPhonePreviewToken(sessionId: string, revision: number) {
  return `${sessionId}:${revision}`;
}

function getWebSocketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/realtime`;
}

function sendJson(socket: WebSocket | null, payload: unknown) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

function buildDesktopState(forcePhonePreview = false) {
  const state = useDirectorStore.getState();
  const phonePreviewUpdate = getPhonePreviewUpdate(state.project);
  const includePhonePreview = forcePhonePreview || phonePreviewUpdate.phonePreviewRevision !== lastSentPhonePreviewRevision;
  if (includePhonePreview) lastSentPhonePreviewRevision = phonePreviewUpdate.phonePreviewRevision;
  return {
    activeCameraId: state.project.activeCameraId,
    cameras: state.project.cameras.map((camera) => ({
      id: camera.id,
      name: camera.name,
      phoneUpdatedAt: getPhoneCameraUpdateTimestamp(camera.id),
      ...getCameraViewSnapshotFromShot(camera),
    })),
    cameraAnimations: state.project.cameraAnimations.map((animation) => ({
      id: animation.id,
      name: animation.name,
      cameraId: animation.cameraId,
      keyframeCount: animation.keyframes.length,
    })),
    phoneAssignments: getPhoneCameraAssignments(),
    phoneCameraOwners: getPhoneCameraOwners(),
    phoneMocapAssignments: getPhoneMocapAssignments(),
    mocapCharacters: state.project.objects
      .filter((object) => object.kind === "character" && object.characterRig?.rigType === "ue4-mannequin" && !object.assetRefId)
      .map((object) => ({ id: object.id, name: object.name, crowdId: object.crowdId ?? null })),
    characterAnimationElapsed: getCharacterAnimationElapsedSnapshot(),
    objectAnimationElapsed: getObjectAnimationElapsedSnapshot(state.project.objects),
    animationSequenceRuntime: getAnimationSequenceRuntimeSnapshot(),
    cameraDrivenAnimationCameraIds: state.project.cameras
      .filter((camera) =>
        state.project.objects.some(
          (object) =>
            object.kind === "character" &&
            object.characterActionTrack?.enabled &&
            object.characterActionTrack.playbackMode === "camera-driven" &&
            (!object.characterActionTrack.cameraId || object.characterActionTrack.cameraId === camera.id)
        )
      )
      .map((camera) => camera.id),
    viewportAspectRatio: state.viewportAspectRatio,
    phonePreviewRevision: phonePreviewUpdate.phonePreviewRevision,
    phonePreviewToken: createPhonePreviewToken(phonePreviewSessionId, phonePreviewUpdate.phonePreviewRevision),
    phonePreviewPending: phonePreviewUpdate.phonePreviewPending,
    phonePreviewError: phonePreviewUpdate.phonePreviewError,
    ...(includePhonePreview ? { phonePreviewProject: phonePreviewUpdate.phonePreviewProject } : {}),
  };
}

export function startDirectorDeskRealtime() {
  let stopped = false;
  let socket: WebSocket | null = null;
  let reconnectTimer = 0;
  let desktopStateFrame = 0;
  let unsubscribeStore: (() => void) | null = null;
  let unsubscribeAnimationRuntime: (() => void) | null = null;
  let unsubscribeSequenceRuntime: (() => void) | null = null;

  function sendDesktopState(forcePhonePreview = false) {
    desktopStateFrame = 0;
    sendJson(socket, {
      type: "desktop_state",
      state: buildDesktopState(forcePhonePreview),
    });
  }

  function scheduleDesktopState() {
    if (desktopStateFrame) return;
    desktopStateFrame = window.requestAnimationFrame(() => sendDesktopState(false));
  }

  requestPhonePreviewBroadcast = scheduleDesktopState;

  function connect() {
    if (stopped) return;
    socket = new WebSocket(getWebSocketUrl());

    socket.addEventListener("open", () => {
      sendJson(socket, {
        type: "client_hello",
        clientType: "desktop",
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(),
      });
      lastSentPhonePreviewRevision = -1;
      sendDesktopState(true);
    });

    socket.addEventListener("message", (event) => {
      let message: {
        type?: string;
        phoneClientId?: string;
        payload?: unknown;
        command?: { id: string; tool: string; args?: unknown };
      };
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (message.type === "phone_state" && message.payload) {
        queuePhoneCameraState(message.payload);
        return;
      }

      if (message.type === "phone_control" && message.payload) {
        queuePhoneCameraState(message.payload);
        return;
      }

      if (message.type === "phone_mocap" && message.payload) {
        handlePhoneMocapState(message.payload);
        scheduleDesktopState();
        return;
      }

      if (message.type === "phone_pose" && message.payload) {
        handlePhonePoseState(message.payload);
        scheduleDesktopState();
        return;
      }

      if (message.type === "phone_disconnected" && typeof message.phoneClientId === "string") {
        releasePhoneCamera(message.phoneClientId);
        releasePhoneMocap(message.phoneClientId);
        releasePhonePose(message.phoneClientId);
        scheduleDesktopState();
        return;
      }

      if (message.type === "agent_command" && message.command) {
        const { id, tool, args } = message.command;
        void executeDirectorAgentTool(tool, args ?? {})
          .then((result) => sendJson(socket, { type: "agent_result", id, result }))
          .catch((error) =>
            sendJson(socket, {
              type: "agent_result",
              id,
              error: error instanceof Error ? error.message : "Command failed",
            })
          );
      }
    });

    socket.addEventListener("close", () => {
      if (stopped) return;
      reconnectTimer = window.setTimeout(connect, 500);
    });
  }

  unsubscribeStore = useDirectorStore.subscribe(scheduleDesktopState);
  unsubscribeAnimationRuntime = subscribeCharacterAnimationRuntime(scheduleDesktopState);
  unsubscribeSequenceRuntime = subscribeAnimationSequenceRuntime(scheduleDesktopState);
  const sendDesktopPresence = () => {
    sendJson(socket, {
      type: "desktop_presence",
      visibilityState: document.visibilityState,
      hasFocus: document.hasFocus(),
    });
    if (document.visibilityState === "visible") scheduleDesktopState();
  };
  document.addEventListener("visibilitychange", sendDesktopPresence);
  window.addEventListener("focus", sendDesktopPresence);
  window.addEventListener("blur", sendDesktopPresence);
  window.addEventListener("pageshow", sendDesktopPresence);
  window.addEventListener("pointerdown", sendDesktopPresence, { passive: true });
  connect();

  return () => {
    stopped = true;
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    if (desktopStateFrame) window.cancelAnimationFrame(desktopStateFrame);
    if (requestPhonePreviewBroadcast === scheduleDesktopState) requestPhonePreviewBroadcast = null;
    unsubscribeStore?.();
    unsubscribeAnimationRuntime?.();
    unsubscribeSequenceRuntime?.();
    document.removeEventListener("visibilitychange", sendDesktopPresence);
    window.removeEventListener("focus", sendDesktopPresence);
    window.removeEventListener("blur", sendDesktopPresence);
    window.removeEventListener("pageshow", sendDesktopPresence);
    window.removeEventListener("pointerdown", sendDesktopPresence);
    socket?.close();
  };
}
