import { useEffect, useMemo, useRef, useState } from "react";
import { Compass, Maximize2, Minimize2, RotateCcw, Send, Video } from "lucide-react";
import type { CameraViewSnapshot } from "../editor/schema/cameraGeometry";
import type { DirectorProject } from "../editor/schema/directorProject";
import type { ViewportAspectRatio } from "../editor/schema/viewportAspectRatio";
import { useDirectorStore } from "../editor/store/directorStore";
import { setCharacterAnimationElapsedSnapshot } from "../editor/animation/characterAnimation";
import { setObjectAnimationElapsedSnapshot } from "../editor/animation/objectAnimation";
import {
  setAnimationSequenceRuntimeSnapshot,
  type AnimationSequenceRuntimeSnapshot,
} from "../editor/animation/animationSequence";
import { PhoneCameraPreview } from "./PhoneCameraPreview";
import { PhoneModeNav } from "./PhoneModeNav";
import {
  getMotionCameraTarget,
  smoothMotionCameraAngles,
} from "./phoneMotion";
import { shouldApplyPhonePreview } from "./phonePreviewSync";

type Tuple3 = [number, number, number];

interface SessionInfo {
  desktopUrl: string;
  phoneUrl: string | null;
  localPhoneUrl?: string;
  websocketUrl: string;
  lanUrls: string[];
}

interface PhoneCameraOption {
  id: string;
  name: string;
  fov: number;
  position?: Tuple3;
  target?: Tuple3;
  phoneUpdatedAt?: number;
}

interface DesktopStateMessage {
  activeCameraId?: string;
  cameras?: PhoneCameraOption[];
  phoneAssignments?: Record<string, string>;
  phoneCameraOwners?: Record<string, string>;
  phonePreviewRevision?: number;
  phonePreviewToken?: string;
  phonePreviewProject?: DirectorProject;
  phonePreviewPending?: boolean;
  phonePreviewError?: string | null;
  viewportAspectRatio?: ViewportAspectRatio;
  cameraDrivenAnimationCameraIds?: string[];
  characterAnimationElapsed?: Record<string, number>;
  objectAnimationElapsed?: Record<string, number>;
  animationSequenceRuntime?: AnimationSequenceRuntimeSnapshot;
}

interface LiveCameraState {
  position: Tuple3;
  yaw: number;
  pitch: number;
  roll: number;
  fov: number;
  cameraId: string;
  recording: boolean;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getWebSocketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/realtime`;
}

function sendJson(socket: WebSocket | null, payload: unknown) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(payload));
  return true;
}

function getPhoneControllerId() {
  const storageKey = "storyai-director-phone-controller-id";
  const existing = window.localStorage.getItem(storageKey);
  if (existing && /^[a-z0-9_-]{8,80}$/i.test(existing)) return existing;
  const randomPart = window.crypto?.randomUUID?.().replace(/-/g, "") ?? Math.random().toString(36).slice(2);
  const controllerId = `phone_${randomPart}`;
  window.localStorage.setItem(storageKey, controllerId);
  return controllerId;
}

function getCameraAngles(camera: PhoneCameraOption | null, fallbackYaw: number, fallbackPitch: number) {
  if (!camera?.position || !camera.target) return { yaw: fallbackYaw, pitch: fallbackPitch };
  const dx = camera.target[0] - camera.position[0];
  const dy = camera.target[1] - camera.position[1];
  const dz = camera.target[2] - camera.position[2];
  const horizontal = Math.hypot(dx, dz);
  if (horizontal < 0.0001) return { yaw: fallbackYaw, pitch: fallbackPitch };
  return {
    yaw: Math.atan2(dx, -dz),
    pitch: Math.atan2(dy, horizontal),
  };
}

function getAspectUnits(ratio: ViewportAspectRatio): [number, number] {
  switch (ratio) {
    case "1:1":
      return [1, 1];
    case "2:1":
      return [2, 1];
    case "3:4":
      return [3, 4];
    case "4:3":
      return [4, 3];
    case "21:9":
      return [21, 9];
    case "9:16":
      return [9, 16];
    case "16:9":
    case "auto":
    default:
      return [16, 9];
  }
}

function hasCameraSnapshotDifference(
  current: LiveCameraState,
  camera: PhoneCameraOption,
  position: Tuple3,
  yaw: number,
  pitch: number
) {
  if (current.cameraId !== camera.id) return true;
  if (Math.abs(current.fov - camera.fov) > 0.01) return true;
  if (Math.abs(current.yaw - yaw) > 0.0005 || Math.abs(current.pitch - pitch) > 0.0005) return true;
  return position.some((value, index) => Math.abs(value - current.position[index]) > 0.001);
}

function getMotionSample(event: DeviceOrientationEvent) {
  const screenAngle = Math.round(window.screen.orientation?.angle ?? 0);
  const alpha = (event.alpha ?? 0) + screenAngle;
  const beta = event.beta ?? 0;
  const gamma = event.gamma ?? 0;

  if (screenAngle === 90 || screenAngle === -270) {
    return { alpha, beta: gamma, gamma: -beta };
  }
  if (screenAngle === -90 || screenAngle === 270) {
    return { alpha, beta: -gamma, gamma: beta };
  }
  if (Math.abs(screenAngle) === 180) {
    return { alpha, beta: -beta, gamma: -gamma };
  }
  return { alpha, beta, gamma };
}

export function PhoneController() {
  const isMotionMode = new URLSearchParams(window.location.search).get("mode") === "motion";
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [status, setStatus] = useState("等待连接");
  const [position, setPosition] = useState<Tuple3>([0, 1.6, 5]);
  const [yaw, setYaw] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [roll, setRoll] = useState(0);
  const [fov, setFov] = useState(35);
  const [cameras, setCameras] = useState<PhoneCameraOption[]>([]);
  const [cameraOwners, setCameraOwners] = useState<Record<string, string>>({});
  const [cameraId, setCameraId] = useState<string>("");
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [immersiveMode, setImmersiveMode] = useState(false);
  const [joystickVisual, setJoystickVisual] = useState({ x: 0, z: 0 });
  const [recording, setRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState<5 | 10 | 15>(5);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewAspectRatio, setPreviewAspectRatio] = useState<ViewportAspectRatio>("16:9");
  const [cameraDrivenAnimationCameraIds, setCameraDrivenAnimationCameraIds] = useState<string[]>([]);
  const [viewportSize, setViewportSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio || 1,
  }));
  const socketRef = useRef<WebSocket | null>(null);
  const joystickRef = useRef<{ x: number; z: number }>({ x: 0, z: 0 });
  const draggingLookRef = useRef<{ x: number; y: number } | null>(null);
  const dirtyRef = useRef(true);
  const recordingTimerRef = useRef(0);
  const recordingDurationRef = useRef<5 | 10 | 15>(5);
  const controllerIdRef = useRef(getPhoneControllerId());
  const orientationBaseRef = useRef<{
    alpha: number;
    beta: number;
    gamma: number;
    yaw: number;
    pitch: number;
    roll: number;
  } | null>(null);
  const motionTargetRef = useRef<{ yaw: number; pitch: number; roll: number; updatedAt: number } | null>(null);
  const motionWatchdogRef = useRef(0);
  const motionFrameRef = useRef(0);
  const orientationHandlerRef = useRef<(event: DeviceOrientationEvent) => void>(() => {});
  const orientationListenerRef = useRef<(event: DeviceOrientationEvent) => void>((event) => orientationHandlerRef.current(event));
  const previewVersionRef = useRef({ revision: -1, token: "" });
  const previewReadyRef = useRef(false);
  const lastSentAtRef = useRef(0);
  const cameraTopologySignatureRef = useRef("");
  const cameraOwnerSignatureRef = useRef("");
  const cameraDrivenSignatureRef = useRef("");
  const characterAnimationElapsedRef = useRef<Record<string, number>>({});
  const liveStateRef = useRef<LiveCameraState>({
    position: [0, 1.6, 5],
    yaw: 0,
    pitch: 0,
    roll: 0,
    fov: 35,
    cameraId: "",
    recording: false,
  });
  const previewViewRef = useRef<CameraViewSnapshot | null>(null);
  const selectedCamera = useMemo(
    () => cameras.find((camera) => camera.id === cameraId) ?? null,
    [cameraId, cameras]
  );
  const forceLandscape = immersiveMode && viewportSize.height > viewportSize.width;
  const previewStageStyle = useMemo(() => {
    if (immersiveMode) {
      return forceLandscape
        ? { width: viewportSize.height, height: viewportSize.width }
        : { width: viewportSize.width, height: viewportSize.height };
    }
    const widthLimit = immersiveMode ? viewportSize.width : Math.max(viewportSize.width - 28, 0);
    const heightLimit = viewportSize.height * (viewportSize.width <= 390 ? 0.28 : 0.32);
    const [aspectWidth, aspectHeight] = getAspectUnits(previewAspectRatio);
    const scale = Math.max(
      1,
      Math.floor(
        Math.min((widthLimit * viewportSize.dpr) / aspectWidth, (heightLimit * viewportSize.dpr) / aspectHeight)
      )
    );
    const width = (aspectWidth * scale) / viewportSize.dpr;
    const height = (aspectHeight * scale) / viewportSize.dpr;
    return { width, height };
  }, [forceLandscape, immersiveMode, previewAspectRatio, viewportSize]);
  function updateLiveCameraState(patch: Partial<LiveCameraState>, syncUi = true) {
    const next = { ...liveStateRef.current, ...patch };
    liveStateRef.current = next;
    dirtyRef.current = true;
    if (!syncUi) return;
    if (patch.position) setPosition(next.position);
    if (patch.yaw !== undefined) setYaw(next.yaw);
    if (patch.pitch !== undefined) setPitch(next.pitch);
    if (patch.roll !== undefined) setRoll(next.roll);
    if (patch.fov !== undefined) setFov(next.fov);
    if (patch.cameraId !== undefined) setCameraId(next.cameraId);
    if (patch.recording !== undefined) setRecording(next.recording);
  }

  function applyCameraSnapshot(camera: PhoneCameraOption | null, syncUi = true, resetMotion = syncUi) {
    if (!camera) return;
    const nextPosition = camera.position ?? [0, 1.6, 5];
    const angles = getCameraAngles(camera, liveStateRef.current.yaw, liveStateRef.current.pitch);
    if (camera.position && camera.target) {
      previewViewRef.current = {
        fov: camera.fov,
        position: [...camera.position],
        target: [...camera.target],
      };
    }
    if (!hasCameraSnapshotDifference(liveStateRef.current, camera, nextPosition, angles.yaw, angles.pitch)) return;
    updateLiveCameraState({
      cameraId: camera.id,
      position: nextPosition,
      fov: camera.fov,
      yaw: angles.yaw,
      pitch: angles.pitch,
      roll: 0,
    }, syncUi);
    if (resetMotion) {
      orientationBaseRef.current = null;
      motionTargetRef.current = null;
    }
  }

  useEffect(() => {
    fetch("/api/session")
      .then((response) => response.json())
      .then((payload: SessionInfo) => setSession(payload))
      .catch(() => setSession(null));
  }, []);

  useEffect(() => {
    document.body.classList.toggle("phone-immersive", immersiveMode);
    document.body.classList.toggle("phone-force-landscape", forceLandscape);
    return () => {
      document.body.classList.remove("phone-immersive");
      document.body.classList.remove("phone-force-landscape");
    };
  }, [forceLandscape, immersiveMode]);

  useEffect(() => {
    const updateViewportSize = () =>
      setViewportSize({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 });
    window.addEventListener("resize", updateViewportSize);
    return () => window.removeEventListener("resize", updateViewportSize);
  }, []);

  useEffect(() => {
    if (!isMotionMode) return;
    const requestPermission = (window.DeviceOrientationEvent as (typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<"granted" | "denied">;
    }) | undefined)?.requestPermission;
    if (typeof requestPermission !== "function") void enableMotion();
    else setStatus("进入全屏后将自动启用体感");
  }, [isMotionMode]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setImmersiveMode(false);
        (window.screen.orientation as ScreenOrientation & { unlock?: () => void })?.unlock?.();
        if (isMotionMode) disableMotion();
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) window.clearTimeout(recordingTimerRef.current);
      window.removeEventListener("deviceorientation", orientationListenerRef.current, true);
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    let reconnectTimer = 0;

    function connect() {
      if (stopped) return;
      const socket = new WebSocket(getWebSocketUrl());
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        setStatus("已连接电脑导演台");
        sendJson(socket, { type: "client_hello", clientType: "phone" });
        sendCurrentState(true);
      });

      socket.addEventListener("message", (event) => {
        let message: { type?: string; state?: DesktopStateMessage | null };
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }

        if (message.type === "desktop_state" && message.state?.cameras) {
          const desktopAspectRatio = message.state.viewportAspectRatio ?? "auto";
          if (message.state.characterAnimationElapsed) {
            characterAnimationElapsedRef.current = message.state.characterAnimationElapsed;
            setCharacterAnimationElapsedSnapshot(message.state.characterAnimationElapsed);
          }
          if (message.state.objectAnimationElapsed) {
            setObjectAnimationElapsedSnapshot(message.state.objectAnimationElapsed);
          }
          if (message.state.animationSequenceRuntime) {
            setAnimationSequenceRuntimeSnapshot(message.state.animationSequenceRuntime);
          }
          setPreviewAspectRatio((current) => (current === desktopAspectRatio ? current : desktopAspectRatio));
          if (message.state.phonePreviewPending && !previewReadyRef.current && !message.state.phonePreviewProject) {
            setPreviewReady(false);
            setStatus("正在同步当前布景");
          }
          if (message.state.phonePreviewError) {
            if (!previewReadyRef.current && !message.state.phonePreviewProject) {
              setPreviewReady(false);
              setStatus(message.state.phonePreviewError);
            } else {
              setStatus("部分资源未同步，已保留当前可用布景");
            }
          }
          const previewRevision = message.state.phonePreviewRevision ?? 0;
          const previewToken = message.state.phonePreviewToken;
          if (
            message.state.phonePreviewProject &&
            shouldApplyPhonePreview(previewVersionRef.current, previewToken, previewRevision)
          ) {
            previewVersionRef.current = { revision: previewRevision, token: previewToken ?? "" };
            useDirectorStore.getState().replaceProject(message.state.phonePreviewProject);
            setCharacterAnimationElapsedSnapshot(characterAnimationElapsedRef.current);
            if (message.state.objectAnimationElapsed) {
              setObjectAnimationElapsedSnapshot(message.state.objectAnimationElapsed);
            }
            if (message.state.animationSequenceRuntime) {
              setAnimationSequenceRuntimeSnapshot(message.state.animationSequenceRuntime);
            }
            previewReadyRef.current = true;
            setPreviewReady(true);
            if (!liveStateRef.current.recording) setStatus("当前布景已同步");
          }
          const cameraTopologySignature = message.state.cameras.map((camera) => `${camera.id}:${camera.name}`).join("|");
          if (cameraTopologySignature !== cameraTopologySignatureRef.current) {
            cameraTopologySignatureRef.current = cameraTopologySignature;
            setCameras(message.state.cameras);
          }
          const nextOwners = message.state.phoneCameraOwners ?? {};
          const nextDrivenCameraIds = message.state.cameraDrivenAnimationCameraIds ?? [];
          const drivenSignature = [...nextDrivenCameraIds].sort().join("|");
          if (drivenSignature !== cameraDrivenSignatureRef.current) {
            cameraDrivenSignatureRef.current = drivenSignature;
            setCameraDrivenAnimationCameraIds(nextDrivenCameraIds);
          }
          const ownerSignature = Object.entries(nextOwners)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([cameraId, ownerId]) => `${cameraId}:${ownerId}`)
            .join("|");
          if (ownerSignature !== cameraOwnerSignatureRef.current) {
            cameraOwnerSignatureRef.current = ownerSignature;
            setCameraOwners(nextOwners);
          }
          const assignedCameraId = message.state.phoneAssignments?.[controllerIdRef.current];
          const assignedCamera = message.state.cameras.find((camera) => camera.id === assignedCameraId) ?? null;
          const controlledCamera = message.state.cameras.find(
            (camera) => camera.id === (assignedCameraId ?? liveStateRef.current.cameraId)
          ) ?? null;
          if (controlledCamera?.position && controlledCamera.target) {
            previewViewRef.current = {
              fov: controlledCamera.fov,
              position: [...controlledCamera.position],
              target: [...controlledCamera.target],
            };
          }
          const bootstrapCamera =
            assignedCamera ??
            (liveStateRef.current.cameraId
              ? null
              : message.state.cameras.find((camera) => camera.id === message.state?.activeCameraId) ?? null);
          if (bootstrapCamera) {
            const isNewCamera = liveStateRef.current.cameraId !== bootstrapCamera.id;
            const controlStateAcknowledged =
              typeof bootstrapCamera.phoneUpdatedAt !== "number" || bootstrapCamera.phoneUpdatedAt >= lastSentAtRef.current;
            if (isNewCamera || controlStateAcknowledged) applyCameraSnapshot(bootstrapCamera, isNewCamera);
            if (isNewCamera) {
              sendCurrentState(true);
              if (!liveStateRef.current.recording) {
                setStatus(assignedCamera ? `已控制 ${bootstrapCamera.name}` : `正在绑定 ${bootstrapCamera.name}`);
              }
            }
          }
        }
      });

      socket.addEventListener("close", () => {
        if (stopped) return;
        setStatus("连接中断，正在重连");
        reconnectTimer = window.setTimeout(connect, 500);
      });
    }

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const joystick = joystickRef.current;
      const inputX = joystick.x;
      const inputZ = joystick.z;
      if (Math.abs(inputX) < 0.01 && Math.abs(inputZ) < 0.01) return;
      const current = liveStateRef.current;
      const speed = 0.07;
      const sinYaw = Math.sin(current.yaw);
      const cosYaw = Math.cos(current.yaw);
      const forwardX = sinYaw * inputZ * speed;
      const forwardZ = -cosYaw * inputZ * speed;
      const strafeX = cosYaw * inputX * speed;
      const strafeZ = sinYaw * inputX * speed;
      updateLiveCameraState({
        position: [
          Number((current.position[0] + forwardX + strafeX).toFixed(3)),
          current.position[1],
          Number((current.position[2] + forwardZ + strafeZ).toFixed(3)),
        ],
      }, false);
    }, 16);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      sendCurrentState(false);
    }, 33);
    return () => window.clearInterval(interval);
  }, []);

  function disableMotion() {
    window.removeEventListener("deviceorientation", orientationListenerRef.current, true);
    if (motionWatchdogRef.current) window.clearTimeout(motionWatchdogRef.current);
    if (motionFrameRef.current) window.cancelAnimationFrame(motionFrameRef.current);
    motionWatchdogRef.current = 0;
    motionFrameRef.current = 0;
    orientationBaseRef.current = null;
    motionTargetRef.current = null;
    setMotionEnabled(false);
    setStatus("已关闭体感，当前使用触控控制");
  }

  function flushMotionFrame() {
    motionFrameRef.current = 0;
    const target = motionTargetRef.current;
    if (!target) return;

    const current = liveStateRef.current;
    const next = smoothMotionCameraAngles(current, target, 16 + performance.now() - target.updatedAt);
    if (next !== current) {
      updateLiveCameraState({
        yaw: next.yaw,
        pitch: next.pitch,
        roll: next.roll,
      }, false);
      motionFrameRef.current = window.requestAnimationFrame(flushMotionFrame);
    }
  }

  function scheduleMotionFrame() {
    if (!motionFrameRef.current) motionFrameRef.current = window.requestAnimationFrame(flushMotionFrame);
  }

  async function enableMotion() {
    if (!isMotionMode) return;
    if (motionEnabled) {
      orientationBaseRef.current = null;
      motionTargetRef.current = null;
      setStatus("请保持当前取景方向，体感已重新校准");
      return;
    }

    if (!window.isSecureContext) {
      setStatus("体感需要 HTTPS 手机地址；HTTP 控制页只能使用触控");
      return;
    }

    if (!("DeviceOrientationEvent" in window)) {
      setStatus("当前浏览器没有开放体感接口");
      return;
    }

    const deviceOrientation = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<"granted" | "denied">;
    };

    try {
      if (typeof deviceOrientation.requestPermission === "function") {
        const permission = await deviceOrientation.requestPermission();
        if (permission !== "granted") {
          setStatus("体感权限未开启");
          return;
        }
      }
      window.removeEventListener("deviceorientation", orientationListenerRef.current, true);
      orientationBaseRef.current = null;
      motionTargetRef.current = null;
      window.addEventListener("deviceorientation", orientationListenerRef.current, true);
      setMotionEnabled(true);
      setStatus("请保持当前取景方向，正在校准体感");
      if (motionWatchdogRef.current) window.clearTimeout(motionWatchdogRef.current);
      motionWatchdogRef.current = window.setTimeout(() => {
        setStatus("未收到体感数据，请检查系统的浏览器运动与方向权限");
      }, 2500);
    } catch {
      setStatus("当前浏览器无法开启体感");
    }
  }

  function handleDeviceOrientation(event: DeviceOrientationEvent) {
    if (event.alpha == null || event.beta == null || event.gamma == null) return;
    if (motionWatchdogRef.current) {
      window.clearTimeout(motionWatchdogRef.current);
      motionWatchdogRef.current = 0;
      setStatus("体感已开启");
    }

    const current = liveStateRef.current;
    const sample = getMotionSample(event);
    if (!orientationBaseRef.current) {
      orientationBaseRef.current = {
        alpha: sample.alpha,
        beta: sample.beta,
        gamma: sample.gamma,
        yaw: current.yaw,
        pitch: current.pitch,
        roll: current.roll,
      };
    }

    const base = orientationBaseRef.current;
    const target = getMotionCameraTarget(sample, base, {
      yaw: base.yaw,
      pitch: base.pitch,
      roll: base.roll,
    });
    const now = performance.now();
    motionTargetRef.current = { ...target, updatedAt: now };
    scheduleMotionFrame();
  }

  function resetCamera() {
    joystickRef.current = { x: 0, z: 0 };
    setJoystickVisual({ x: 0, z: 0 });
    updateLiveCameraState({
      position: [0, 1.6, 5],
      yaw: 0,
      pitch: 0,
      roll: 0,
      fov: selectedCamera?.fov ?? 35,
    });
    orientationBaseRef.current = null;
    motionTargetRef.current = null;
    setStatus("已重置");
  }

  function calibrateMotion() {
    orientationBaseRef.current = null;
    motionTargetRef.current = null;
    setStatus(motionEnabled ? "已校准当前位置和朝向" : "进入全屏后将自动校准体感");
  }

  function setJoystickFromPointer(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
    const y = clamp(((event.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
    joystickRef.current = { x, z: -y };
    setJoystickVisual({ x, z: -y });
  }

  function releaseJoystick() {
    joystickRef.current = { x: 0, z: 0 };
    setJoystickVisual({ x: 0, z: 0 });
  }

  async function toggleFullscreenControl() {
    if (immersiveMode || document.fullscreenElement) {
      if (document.fullscreenElement) {
        try {
          await document.exitFullscreen();
        } catch {
          // CSS immersive mode remains available when the browser refuses an exit request.
        }
      }
      (window.screen.orientation as ScreenOrientation & { unlock?: () => void })?.unlock?.();
      if (isMotionMode) disableMotion();
      setImmersiveMode(false);
      return;
    }

    if (isMotionMode) void enableMotion();

    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Some mobile browsers do not expose the Fullscreen API but can still use the immersive layout.
    }
    setImmersiveMode(true);
    const orientation = window.screen.orientation as ScreenOrientation & {
      lock?: (orientation: string) => Promise<void>;
    };
    try {
      await orientation?.lock?.("landscape-primary");
    } catch {
      try {
        await orientation?.lock?.("landscape");
      } catch {
        // iOS Safari and some Android browsers use the rotated CSS fallback.
      }
    }
  }

  function sendOnce() {
    sendCurrentState(true);
    setStatus("已同步机位");
  }

  function sendCurrentState(force: boolean) {
    const activeJoystick = Math.abs(joystickRef.current.x) > 0.01 || Math.abs(joystickRef.current.z) > 0.01;
    if (!force && !dirtyRef.current && !liveStateRef.current.recording && !activeJoystick) return;
    const updatedAt = Date.now();
    const sent = sendJson(socketRef.current, {
      type: "phone_state",
      payload: {
        ...liveStateRef.current,
        phoneClientId: controllerIdRef.current,
        recordingDuration: recordingDurationRef.current,
        updatedAt,
      },
    });
    if (sent) {
      lastSentAtRef.current = updatedAt;
      dirtyRef.current = false;
    }
  }

  function handleCameraSelect(nextCameraId: string) {
    const nextCamera = cameras.find((camera) => camera.id === nextCameraId) ?? null;
    if (!nextCameraId) {
      setStatus("正在保留已分配的独立机位");
      return;
    }
    if (cameraOwners[nextCameraId] && cameraOwners[nextCameraId] !== controllerIdRef.current) {
      setStatus("该机位正由另一台手机控制");
      return;
    }
    applyCameraSnapshot(nextCamera);
    setStatus(`正在申请控制 ${nextCamera?.name ?? "机位"}`);
    sendCurrentState(true);
  }

  function updateHeight(value: number) {
    const nextPosition: Tuple3 = [liveStateRef.current.position[0], value, liveStateRef.current.position[2]];
    updateLiveCameraState({ position: nextPosition });
    sendCurrentState(true);
  }

  function updateFov(value: number) {
    updateLiveCameraState({ fov: value });
    sendCurrentState(true);
  }

  function startRecording() {
    if (recordingTimerRef.current) window.clearTimeout(recordingTimerRef.current);
    updateLiveCameraState({ recording: true });
    sendCurrentState(true);
    setStatus(
      cameraDrivenAnimationCameraIds.includes(liveStateRef.current.cameraId)
        ? `正在录制 ${recordingDuration} 秒轨迹，移动镜头会推动角色动作`
        : `正在录制 ${recordingDuration} 秒轨迹`
    );
    recordingTimerRef.current = window.setTimeout(stopRecording, recordingDuration * 1000);
  }

  function stopRecording() {
    if (recordingTimerRef.current) {
      window.clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = 0;
    }
    updateLiveCameraState({ recording: false });
    sendCurrentState(true);
    setStatus("轨迹已保存");
  }

  function toggleRecording() {
    if (recording) {
      stopRecording();
      return;
    }
    startRecording();
  }

  orientationHandlerRef.current = handleDeviceOrientation;

  return (
    <main className="phone-controller">
      <header className="phone-header">
        <div>
          <h1>{isMotionMode ? "体感摄影机" : "手机摄影机"}</h1>
          <p>{status}</p>
        </div>
        <button type="button" aria-label="重置摄影机" onClick={resetCamera}>
          <RotateCcw aria-hidden="true" size={18} />
        </button>
      </header>
      <PhoneModeNav active="camera" />

      <div className="phone-preview-stage" style={previewStageStyle}>
        <PhoneCameraPreview
          cameraId={cameraId}
          cameraOptions={cameras.map((camera) => ({
            id: camera.id,
            name: camera.name,
            disabled: Boolean(cameraOwners[camera.id]) && cameraOwners[camera.id] !== controllerIdRef.current,
          }))}
          ready={previewReady}
          viewRef={previewViewRef}
          displayFov={fov}
          onCameraChange={handleCameraSelect}
        />
        <section
          className="phone-look-pad"
          aria-label="镜头朝向控制"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            draggingLookRef.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerMove={(event) => {
            if (!draggingLookRef.current) return;
            const dx = event.clientX - draggingLookRef.current.x;
            const dy = event.clientY - draggingLookRef.current.y;
            draggingLookRef.current = { x: event.clientX, y: event.clientY };
            const nextYaw = liveStateRef.current.yaw + dx * 0.006;
            const nextPitch = clamp(liveStateRef.current.pitch - dy * 0.004, -1.1, 1.1);
            updateLiveCameraState({ yaw: nextYaw, pitch: nextPitch }, false);
            orientationBaseRef.current = null;
            motionTargetRef.current = null;
            sendCurrentState(true);
          }}
          onPointerUp={() => {
            draggingLookRef.current = null;
          }}
          onPointerCancel={() => {
            draggingLookRef.current = null;
          }}
        />
      </div>

      <section className="phone-controls">
        <div
          className="phone-joystick"
          aria-label="摄影机移动摇杆"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setJoystickFromPointer(event);
          }}
          onPointerMove={(event) => {
            if (event.buttons === 0) return;
            setJoystickFromPointer(event);
          }}
          onPointerUp={() => {
            releaseJoystick();
          }}
          onPointerCancel={releaseJoystick}
        >
          <b
            aria-hidden="true"
            className="phone-joystick-thumb"
            style={{ transform: `translate(${joystickVisual.x * 34}px, ${-joystickVisual.z * 34}px)` }}
          />
          <span>移动</span>
          <i className="phone-joystick-label is-forward">推近</i>
          <i className="phone-joystick-label is-back">后退</i>
          <i className="phone-joystick-label is-left">左移</i>
          <i className="phone-joystick-label is-right">右移</i>
        </div>
        <div className="phone-sliders">
          <label>
            轨迹时长
            <div className="phone-duration-options" role="group" aria-label="选择轨迹录制时长">
              {[5, 10, 15].map((duration) => (
                <button
                  key={duration}
                  type="button"
                  className={recordingDuration === duration ? "is-active" : undefined}
                  onClick={() => {
                    const nextDuration = duration as 5 | 10 | 15;
                    recordingDurationRef.current = nextDuration;
                    setRecordingDuration(nextDuration);
                  }}
                >
                  {duration}秒
                </button>
              ))}
            </div>
          </label>
          <label>
            高度 {position[1].toFixed(1)}
            <input
              type="range"
              min="0.4"
              max="3.2"
              step="0.1"
              value={position[1]}
              onChange={(event) => updateHeight(Number(event.currentTarget.value))}
            />
          </label>
          <label>
            焦段 {fov}
            <input
              type="range"
              min="18"
              max="80"
              step="1"
              value={fov}
              onChange={(event) => updateFov(Number(event.currentTarget.value))}
            />
          </label>
        </div>
      </section>

      <div className="phone-action-grid">
        {isMotionMode ? (
          <button type="button" onClick={calibrateMotion}>
            <Compass aria-hidden="true" size={17} />
            校准体感
          </button>
        ) : null}
        <button type="button" onClick={() => void toggleFullscreenControl()}>
          {immersiveMode ? <Minimize2 aria-hidden="true" size={17} /> : <Maximize2 aria-hidden="true" size={17} />}
          {immersiveMode ? "退出全屏" : "全屏操控"}
        </button>
        <button
          type="button"
          className={recording ? "is-recording" : undefined}
          onClick={toggleRecording}
        >
          <Video aria-hidden="true" size={17} />
          {recording ? "停止并保存轨迹" : `录制${recordingDuration}秒`}
        </button>
      </div>

      <button className="phone-send" type="button" onClick={sendOnce}>
        <Send aria-hidden="true" size={17} />
        同步机位
      </button>

      {session ? (
        <footer className="phone-session">
          <span>电脑端</span>
          <code>{session.desktopUrl}</code>
        </footer>
      ) : null}
    </main>
  );
}
