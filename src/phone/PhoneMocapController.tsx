import { useEffect, useRef, useState } from "react";
import { Camera, CircleDot, RotateCcw, Square, Video } from "lucide-react";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import {
  applyPoseCalibration,
  hasUsableUpperBodyPose,
  mapPoseLandmarksToControls,
  type PoseCalibration,
  type PoseLandmarkSample,
} from "../editor/mocap/poseMapping";
import { PhoneModeNav } from "./PhoneModeNav";

type Duration = 5 | 10 | 15;

type MocapCharacter = { id: string; name: string; crowdId?: string | null };

const MODEL_PATH = "/mediapipe/pose_landmarker_full.task";
const WASM_PATH = "/mediapipe/wasm";
const SKELETON_CONNECTIONS: Array<[number, number]> = [
  [0, 11], [0, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [28, 30], [30, 32],
];

function getWebSocketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/realtime`;
}

function getPhoneMocapId() {
  const storageKey = "storyai-director-phone-mocap-id";
  const existing = window.localStorage.getItem(storageKey);
  if (existing && /^[a-z0-9_-]{8,80}$/i.test(existing)) return existing;
  const value = `mocap_${window.crypto?.randomUUID?.().replace(/-/g, "") ?? Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(storageKey, value);
  return value;
}

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

function send(socket: WebSocket | null, payload: unknown) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(payload));
  return true;
}

export function PhoneMocapController() {
  const [status, setStatus] = useState("等待连接导演台");
  const [characters, setCharacters] = useState<MocapCharacter[]>([]);
  const [characterId, setCharacterId] = useState("");
  const [duration, setDuration] = useState<Duration>(5);
  const [ready, setReady] = useState(false);
  const [bodyDetected, setBodyDetected] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const frameRef = useRef(0);
  const lastDetectAtRef = useRef(0);
  const lastSampleAtRef = useRef(0);
  const startedAtRef = useRef(0);
  const rawControlsRef = useRef<Record<string, number>>({});
  const calibrationRef = useRef<PoseCalibration | null>(null);
  const recordingRef = useRef(false);
  const pendingRecordingRef = useRef(false);
  const durationRef = useRef<Duration>(5);
  const characterIdRef = useRef("");
  const phoneIdRef = useRef(getPhoneMocapId());

  function stopCamera() {
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setReady(false);
    setBodyDetected(false);
    const context = overlayRef.current?.getContext("2d");
    if (context && overlayRef.current) context.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
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

  function finishRecording(cancelled = false) {
    if (!recordingRef.current && !pendingRecordingRef.current) return;
    recordingRef.current = false;
    pendingRecordingRef.current = false;
    setRecording(false);
    send(socketRef.current, {
      type: "phone_mocap",
      payload: {
        phoneClientId: phoneIdRef.current,
        characterId: characterIdRef.current,
        phase: cancelled ? "cancel" : "finish",
      },
    });
    setStatus(cancelled ? "已取消手机动捕" : "动作已保存到导演台角色");
  }

  function beginRecording() {
    const targetCharacterId = characterIdRef.current;
    if (!targetCharacterId || !Object.keys(rawControlsRef.current).length) return;
    calibrationRef.current = { ...rawControlsRef.current };
    pendingRecordingRef.current = false;
    startedAtRef.current = performance.now();
    lastSampleAtRef.current = -1;
    recordingRef.current = true;
    setElapsed(0);
    setRecording(true);
    send(socketRef.current, {
      type: "phone_mocap",
      payload: {
        phoneClientId: phoneIdRef.current,
        characterId: targetCharacterId,
        phase: "start",
        duration: durationRef.current,
      },
    });
    setStatus(`正在录制 ${durationRef.current} 秒角色骨骼动作`);
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
        rawControlsRef.current = rawControls;
        setBodyDetected(true);
        if (pendingRecordingRef.current && !recordingRef.current) beginRecording();
        if (recordingRef.current) {
          const seconds = (now - startedAtRef.current) / 1000;
          const controls = applyPoseCalibration(rawControls, calibrationRef.current);
          if (seconds - lastSampleAtRef.current >= 1 / 30) {
            lastSampleAtRef.current = seconds;
            send(socketRef.current, {
              type: "phone_mocap",
              payload: {
                phoneClientId: phoneIdRef.current,
                characterId: characterIdRef.current,
                phase: "frame",
                time: Number(seconds.toFixed(3)),
                controls,
              },
            });
            setElapsed(seconds);
          }
          if (seconds >= durationRef.current) finishRecording();
        }
      } else {
        setBodyDetected(false);
        if (recordingRef.current) setStatus("正在录制，请让头、肩、手臂保持在画面内");
      }
    }
    frameRef.current = window.requestAnimationFrame(detectFrame);
  }

  async function openCamera() {
    if (ready) return;
    if (!window.isSecureContext) {
      setStatus("正在切换到安全 HTTPS 动捕地址");
      try {
        const response = await fetch("/api/session", { cache: "no-store" });
        const session = (await response.json()) as { phoneUrl?: string | null };
        const secureUrl = session.phoneUrl?.replace("mode=motion", "mode=mocap");
        if (secureUrl) {
          window.location.assign(secureUrl);
          return;
        }
      } catch {
        // Show the actionable message below.
      }
      setStatus("摄像头需要 HTTPS，请等待导演台安全手机地址就绪后重试");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("当前地址无法访问手机摄像头，请使用安全 HTTPS 动捕二维码");
      return;
    }
    try {
      setStatus("正在打开手机摄像头和骨骼识别");
      const [stream, landmarker] = await Promise.all([
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
        createLandmarker(),
      ]);
      streamRef.current = stream;
      landmarkerRef.current = landmarker;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setReady(true);
      setStatus("请完整站入画面；空间不足时，上半身也可录制");
      frameRef.current = window.requestAnimationFrame(detectFrame);
    } catch (error) {
      stopCamera();
      setStatus(error instanceof Error ? `无法启动摄像头：${error.message}` : "无法启动手机摄像头");
    }
  }

  function startRecording() {
    if (!characterIdRef.current) {
      setStatus("请先选择要驱动的角色");
      return;
    }
    if (!ready) {
      setStatus("请先打开手机摄像头");
      return;
    }
    if (!bodyDetected || !Object.keys(rawControlsRef.current).length) {
      pendingRecordingRef.current = true;
      setStatus("等待检测到完整身体后自动开始录制");
      return;
    }
    beginRecording();
  }

  useEffect(() => {
    let stopped = false;
    let reconnectTimer = 0;
    const connect = () => {
      if (stopped) return;
      const socket = new WebSocket(getWebSocketUrl());
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        setStatus("已连接导演台，请选择角色并打开摄像头");
        send(socket, { type: "client_hello", clientType: "phone" });
      });
      socket.addEventListener("message", (event) => {
        let message: { type?: string; state?: { mocapCharacters?: MocapCharacter[]; phoneMocapAssignments?: Record<string, string> } };
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (message.type !== "desktop_state" || !message.state?.mocapCharacters) return;
        const nextCharacters = message.state.mocapCharacters;
        setCharacters(nextCharacters);
        setCharacterId((current) => {
          if (nextCharacters.some((character) => character.id === current)) return current;
          const assigned = message.state?.phoneMocapAssignments?.[phoneIdRef.current];
          return assigned && nextCharacters.some((character) => character.id === assigned) ? assigned : nextCharacters[0]?.id ?? "";
        });
      });
      socket.addEventListener("close", () => {
        if (!stopped) reconnectTimer = window.setTimeout(connect, 500);
      });
    };
    connect();
    return () => {
      stopped = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      finishRecording(true);
      socketRef.current?.close();
      stopCamera();
    };
  }, []);

  useEffect(() => {
    characterIdRef.current = characterId;
  }, [characterId]);

  return (
    <main className="phone-mocap-controller">
      <header className="phone-mocap-header">
        <div>
          <h1>手机角色动捕</h1>
          <p>{status}</p>
        </div>
        <span className={bodyDetected ? "is-detected" : undefined}>{bodyDetected ? "身体已识别" : "等待身体"}</span>
      </header>
      <PhoneModeNav active="mocap" />

      <section className="phone-mocap-stage" aria-label="手机动捕摄像头预览">
        <video ref={videoRef} className="phone-mocap-video" muted playsInline />
        <canvas ref={overlayRef} className="phone-mocap-skeleton" aria-hidden="true" />
        {!ready ? <div className="phone-mocap-empty">打开摄像头后，将身体或上半身置于画面中</div> : null}
        <button className="phone-mocap-open-camera" type="button" onClick={() => void openCamera()} disabled={ready}>
          <Camera aria-hidden="true" size={17} />
          {ready ? "摄像头已开启" : window.isSecureContext ? "打开摄像头" : "切换 HTTPS 开启摄像头"}
        </button>
      </section>

      <section className="phone-mocap-controls">
        <label>
          驱动角色
          <select value={characterId} disabled={recording} onChange={(event) => setCharacterId(event.currentTarget.value)}>
            {characters.length ? characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>) : <option value="">等待角色列表</option>}
          </select>
        </label>
        <div className="phone-mocap-duration" role="group" aria-label="角色动捕时长">
          {[5, 10, 15].map((value) => (
            <button key={value} className={duration === value ? "is-active" : undefined} type="button" disabled={recording} onClick={() => { durationRef.current = value as Duration; setDuration(value as Duration); }}>
              {value}秒
            </button>
          ))}
        </div>
        <div className="phone-mocap-actions">
          <button type="button" className={recording ? "is-recording" : undefined} onClick={recording ? () => finishRecording() : startRecording}>
            {recording ? <Square aria-hidden="true" size={17} /> : <CircleDot aria-hidden="true" size={17} />}
            {recording ? `停止 ${elapsed.toFixed(1)}秒` : `录制${duration}秒`}
          </button>
          <button type="button" onClick={() => { calibrationRef.current = null; setStatus("已重置校准，请保持中立站姿"); }} disabled={!ready || recording}>
            <RotateCcw aria-hidden="true" size={17} />
            重置校准
          </button>
        </div>
      </section>
      <p className="phone-mocap-note"><Video aria-hidden="true" size={15} /> 视频和骨骼关键点仅在手机与本地导演台之间传输，不保存手机录像。</p>
    </main>
  );
}
