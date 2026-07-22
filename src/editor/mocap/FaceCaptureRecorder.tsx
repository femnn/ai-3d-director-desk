import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { DirectorObject, CharacterFaceClip, CharacterFaceFrame, CharacterFaceProfile } from "../schema/directorProject";
import { useDirectorStore } from "../store/directorStore";
import {
  MEDIAPIPE_FACE_CHANNELS,
  createFaceClipChecksum,
  getRelativeHeadRotation,
} from "../animation/characterFaceAnimation";
import {
  playNormalCharacterAnimations,
  resetCharacterAnimationElapsed,
  stopNormalCharacterAnimations,
} from "../animation/characterAnimation";
import { exportFaceAnimationPackage, parseFaceAnimationFile } from "../animation/faceClipIo";
import {
  MAX_TEXT_FACE_INPUT_LENGTH,
  createTextFaceClip,
  getTextFaceTiming,
} from "../animation/textFaceAnimation";

type CaptureFrame = {
  timestamp: number;
  blendshapes: Record<string, number>;
  matrix: number[];
};

type Resolution = "640x480" | "1280x720" | "1920x1080";
const FACE_FPS = 30;

function baseAssetUrl(path: string) {
  const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  return `${base}${path}`;
}

function activeCharacterIds() {
  return useDirectorStore.getState().project.objects
    .filter((object) =>
      object.kind === "character" &&
      (object.characterActionTrack?.enabled || (object.bodyType === "face-capture" && object.characterFaceTrack?.enabled))
    )
    .map((object) => object.id);
}

function downloadJson(fileName: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function FaceCaptureRecorder({ character }: { character: DirectorObject }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerBusyRef = useRef(false);
  const animationFrameRef = useRef(0);
  const lastWorkerFrameAtRef = useRef(0);
  const latestFrameRef = useRef<CaptureFrame | null>(null);
  const neutralFrameRef = useRef<CaptureFrame | null>(null);
  const recordingRef = useRef<{ startedAt: number; duration: number; frames: CharacterFaceFrame[]; previous: number[] | null } | null>(null);
  const finishTimerRef = useRef(0);
  const countdownTimerRef = useRef(0);
  const characterRef = useRef(character);
  characterRef.current = character;

  const clips = useDirectorStore((state) => state.project.characterFaceClips ?? []);
  const setCharacterFaceTrack = useDirectorStore((state) => state.setCharacterFaceTrack);
  const addCharacterFaceClip = useDirectorStore((state) => state.addCharacterFaceClip);
  const deleteCharacterFaceClip = useDirectorStore((state) => state.deleteCharacterFaceClip);
  const selectedClips = useMemo(
    () => clips.filter((clip) => clip.characterId === character.id),
    [character.id, clips]
  );
  const activeClip = character.characterFaceTrack?.clipId
    ? selectedClips.find((clip) => clip.id === character.characterFaceTrack?.clipId)
    : undefined;
  const profile = character.characterFaceTrack?.profile ?? "facecap52";

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [resolution, setResolution] = useState<Resolution>("1280x720");
  const [duration, setDuration] = useState<5 | 10 | 15>(5);
  const [cameraReady, setCameraReady] = useState(false);
  const [trackerReady, setTrackerReady] = useState(false);
  const [faceVisible, setFaceVisible] = useState(false);
  const [recording, setRecording] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("打开摄像头后校准中性表情");
  const [speechText, setSpeechText] = useState("");
  const [generatingTextFace, setGeneratingTextFace] = useState(false);
  const speechTiming = useMemo(() => getTextFaceTiming(speechText), [speechText]);

  function attachClip(input: Omit<CharacterFaceClip, "id" | "characterId">) {
    const target = characterRef.current;
    const currentTarget = useDirectorStore.getState().project.objects.find((object) => object.id === target.id);
    const currentProfile = currentTarget?.characterFaceTrack?.profile ?? "facecap52";
    const id = addCharacterFaceClip({ ...input, characterId: target.id });
    setCharacterFaceTrack(target.id, { clipId: id, profile: currentProfile, enabled: true, loop: true });
    playNormalCharacterAnimations(activeCharacterIds());
    setStatus(`${input.name} 已绑定并循环播放`);
  }

  function finishRecording() {
    window.clearTimeout(finishTimerRef.current);
    const session = recordingRef.current;
    recordingRef.current = null;
    setRecording(false);
    setCountdown(null);
    setProgress(0);
    if (!session?.frames.length) {
      setStatus("没有获取到有效面部帧，请重新录制");
      return;
    }
    const frames = [...session.frames];
    const last = frames[frames.length - 1];
    if (last.time < session.duration) frames.push({ ...last, time: session.duration });
    const clip: Omit<CharacterFaceClip, "id" | "characterId"> = {
      name: `${characterRef.current.name} 面部表演 ${session.duration}秒`,
      duration: session.duration,
      fps: FACE_FPS,
      channels: [...MEDIAPIPE_FACE_CHANNELS],
      frames,
      checksum: "",
    };
    clip.checksum = createFaceClipChecksum(clip);
    attachClip(clip);
  }

  async function generateTextFaceAnimation() {
    if (generatingTextFace) return;
    setGeneratingTextFace(true);
    setStatus("正在分析拼音并生成口型...");
    try {
      const clip = await createTextFaceClip(speechText, characterRef.current.name);
      attachClip(clip);
      setStatus(`文字面部动画已生成 · ${clip.duration} 秒 · 正在循环播放`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "文字面部动画生成失败");
    } finally {
      setGeneratingTextFace(false);
    }
  }

  useEffect(() => {
    if (typeof Worker === "undefined") return;
    // MediaPipe's WASM loader still uses importScripts internally, so this
    // worker must remain classic even though Vite bundles the TypeScript entry.
    const worker = new Worker(baseAssetUrl("face-capture/faceCapture.worker.js"));
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent) => {
      const message = event.data as { type?: string; delegate?: string; frame?: CaptureFrame | null; message?: string };
      if (message.type === "ready") {
        setTrackerReady(true);
        setStatus(`面部追踪已就绪 · ${message.delegate ?? "CPU"}`);
        return;
      }
      if (message.type === "idle") {
        workerBusyRef.current = false;
        return;
      }
      if (message.type === "error" || message.type === "frame-error") {
        setStatus(`面部追踪失败：${message.message ?? "未知错误"}`);
        return;
      }
      if (message.type !== "result") return;
      latestFrameRef.current = message.frame ?? null;
      setFaceVisible(Boolean(message.frame));
      const session = recordingRef.current;
      const neutral = neutralFrameRef.current;
      if (!message.frame || !session || !neutral) return;
      const now = performance.now();
      const time = Math.min(session.duration, (now - session.startedAt) / 1000);
      const values = MEDIAPIPE_FACE_CHANNELS.map((channel, index) => {
        const target = Math.min(1, Math.max(0, (message.frame!.blendshapes[channel] ?? 0) - (neutral.blendshapes[channel] ?? 0)));
        const previous = session.previous?.[index] ?? target;
        return Number((previous + (target - previous) * 0.58).toFixed(4));
      });
      session.previous = values;
      session.frames.push({
        time: Number(time.toFixed(4)),
        values,
        headRotation: getRelativeHeadRotation(message.frame.matrix, neutral.matrix),
      });
      setProgress(Math.min(1, time / session.duration));
      if (time >= session.duration) finishRecording();
    };
    worker.postMessage({
      type: "init",
      wasmPath: baseAssetUrl("mediapipe/wasm"),
      modelPath: baseAssetUrl("face-capture/face_landmarker.task"),
    });
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => () => {
    window.clearTimeout(finishTimerRef.current);
    window.clearTimeout(countdownTimerRef.current);
    window.cancelAnimationFrame(animationFrameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (!cameraReady) return;
    const loop = (now: number) => {
      const video = videoRef.current;
      const worker = workerRef.current;
      if (
        video && worker && trackerReady && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        !workerBusyRef.current && now - lastWorkerFrameAtRef.current >= 1000 / FACE_FPS
      ) {
        workerBusyRef.current = true;
        lastWorkerFrameAtRef.current = now;
        void createImageBitmap(video)
          .then((bitmap) => worker.postMessage({ type: "frame", bitmap, timestamp: now }, [bitmap]))
          .catch(() => { workerBusyRef.current = false; });
      }
      animationFrameRef.current = window.requestAnimationFrame(loop);
    };
    animationFrameRef.current = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(animationFrameRef.current);
  }, [cameraReady, trackerReady]);

  async function refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const next = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput");
    setDevices(next);
    if (!deviceId && next[0]?.deviceId) setDeviceId(next[0].deviceId);
  }

  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("当前浏览器不支持摄像头访问");
      return;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    const [width, height] = resolution.split("x").map(Number);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 30, max: 30 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
      setStatus("请正对摄像头并校准中性表情");
      await refreshDevices();
    } catch (error) {
      setStatus(`无法打开摄像头：${error instanceof Error ? error.message : "权限被拒绝"}`);
      setCameraReady(false);
    }
  }

  function closeCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
    setFaceVisible(false);
    neutralFrameRef.current = null;
    if (recordingRef.current) finishRecording();
    setStatus("摄像头已关闭，已录制片段仍可播放");
  }

  function calibrateNeutral() {
    if (!latestFrameRef.current) {
      setStatus("尚未识别到人脸，请让完整面部进入画面");
      return;
    }
    neutralFrameRef.current = latestFrameRef.current;
    setStatus("中性表情已校准，可以开始录制");
  }

  function beginRecording() {
    if (!cameraReady || !trackerReady || !neutralFrameRef.current || !faceVisible || recording) {
      setStatus("请先打开摄像头、识别人脸并校准中性表情");
      return;
    }
    let count = 3;
    setCountdown(count);
    const tick = () => {
      count -= 1;
      if (count > 0) {
        setCountdown(count);
        countdownTimerRef.current = window.setTimeout(tick, 1000);
        return;
      }
      setCountdown(null);
      const startedAt = performance.now();
      recordingRef.current = { startedAt, duration, frames: [], previous: null };
      setRecording(true);
      setProgress(0);
      setStatus(`正在录制 ${duration} 秒面部动画`);
      finishTimerRef.current = window.setTimeout(finishRecording, duration * 1000 + 350);
    };
    countdownTimerRef.current = window.setTimeout(tick, 1000);
  }

  function updateProfile(next: CharacterFaceProfile) {
    setCharacterFaceTrack(character.id, {
      clipId: character.characterFaceTrack?.clipId ?? null,
      profile: next,
      enabled: Boolean(character.characterFaceTrack?.clipId),
      loop: character.characterFaceTrack?.loop !== false,
    });
  }

  async function importClip(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      attachClip(parseFaceAnimationFile(JSON.parse(await file.text())));
    } catch (error) {
      setStatus(`导入失败：${error instanceof Error ? error.message : "文件无效"}`);
    }
  }

  return (
    <section className="face-capture-panel" aria-label="角色面部动画">
      <div className="face-capture-field">
        <label htmlFor="face-profile">面部模型</label>
        <select id="face-profile" value={profile} onChange={(event) => updateProfile(event.target.value as CharacterFaceProfile)}>
          <option value="facecap52">FaceCap 52 · 精确表情</option>
          <option value="gnm21">GNM Head · 语义表情</option>
        </select>
      </div>
      <div className="face-text-animation" aria-label="文字生成面部动画">
        <div className="face-text-animation-heading">
          <strong>文字面部动画</strong>
          <span>{speechTiming.duration ? `预计时长 ${speechTiming.duration} 秒` : "预计时长 未计算"}</span>
        </div>
        <textarea
          aria-label="面部动画文字"
          maxLength={MAX_TEXT_FACE_INPUT_LENGTH}
          placeholder="输入角色要说的文字，例如：我们现在出发吧！"
          value={speechText}
          onChange={(event) => {
            const next = event.target.value;
            if (getTextFaceTiming(next).exceedsLimit) {
              setStatus("文字最长为15秒，请删减后继续输入");
              return;
            }
            setSpeechText(next);
          }}
        />
        <small>按拼音音素生成口型 · 最长15秒 · {speechText.length}/{MAX_TEXT_FACE_INPUT_LENGTH}字</small>
        <button type="button" disabled={!speechText.trim() || speechTiming.exceedsLimit || generatingTextFace} onClick={generateTextFaceAnimation}>
          {generatingTextFace ? "正在生成口型..." : "生成并循环播放"}
        </button>
      </div>
      <div className="face-capture-field">
        <label htmlFor="face-camera">摄像头</label>
        <select id="face-camera" value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
          {!devices.length ? <option value="">默认摄像头</option> : null}
          {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `摄像头 ${index + 1}`}</option>)}
        </select>
      </div>
      <div className="face-capture-field">
        <label htmlFor="face-resolution">采集分辨率</label>
        <select id="face-resolution" value={resolution} onChange={(event) => setResolution(event.target.value as Resolution)}>
          <option value="640x480">640 × 480</option>
          <option value="1280x720">1280 × 720</option>
          <option value="1920x1080">1920 × 1080</option>
        </select>
      </div>
      <div className={`face-camera-preview${faceVisible ? " has-face" : ""}`}>
        <video ref={videoRef} muted playsInline />
        <div className="face-camera-guide" aria-hidden="true" />
        {countdown ? <strong className="face-countdown">{countdown}</strong> : null}
        {!cameraReady ? <span>打开摄像头后，将完整面部置于画面中央</span> : null}
      </div>
      <div className="face-status" role="status">
        <span className={faceVisible ? "is-ready" : undefined}>{faceVisible ? "已识别人脸" : "等待人脸"}</span>
        <small>{status}</small>
      </div>
      {recording ? <progress max="1" value={progress} aria-label="面部动画录制进度" /> : null}
      <div className="face-button-row">
        <button type="button" onClick={cameraReady ? closeCamera : openCamera}>{cameraReady ? "关闭摄像头" : "打开摄像头"}</button>
        <button type="button" disabled={!cameraReady || !faceVisible || recording} onClick={calibrateNeutral}>校准中性表情</button>
      </div>
      <div className="face-duration-row" role="group" aria-label="面部动画时长">
        {[5, 10, 15].map((value) => (
          <button key={value} type="button" className={duration === value ? "is-active" : undefined} onClick={() => setDuration(value as 5 | 10 | 15)}>{value}秒</button>
        ))}
      </div>
      <button
        type="button"
        className="face-record-button"
        disabled={countdown !== null}
        onClick={recording ? finishRecording : beginRecording}
      >
        {recording ? `停止并保存 · ${Math.round(progress * duration)} / ${duration}秒` : `录制${duration}秒面部动画`}
      </button>
      <div className="face-button-row">
        <button type="button" disabled={!activeClip} onClick={() => playNormalCharacterAnimations(activeCharacterIds())}>播放</button>
        <button type="button" disabled={!activeClip} onClick={stopNormalCharacterAnimations}>暂停</button>
        <button type="button" disabled={!activeClip} onClick={() => resetCharacterAnimationElapsed(character.id)}>回到开头</button>
      </div>
      {character.characterFaceTrack ? (
        <label className="face-loop-toggle">
          <input
            type="checkbox"
            checked={character.characterFaceTrack.loop}
            onChange={(event) => setCharacterFaceTrack(character.id, { ...character.characterFaceTrack!, loop: event.target.checked })}
          />
          循环播放
        </label>
      ) : null}
      <div className="face-button-row">
        <button type="button" onClick={() => fileInputRef.current?.click()}>导入面部动画</button>
        <button
          type="button"
          disabled={!activeClip}
          onClick={() => activeClip && downloadJson(`${character.name}-face.json`, exportFaceAnimationPackage(activeClip))}
        >导出当前片段</button>
        <input ref={fileInputRef} hidden type="file" accept="application/json,.json" onChange={importClip} />
      </div>
      {selectedClips.length ? (
        <div className="face-clip-list">
          <strong>已录制片段</strong>
          {selectedClips.map((clip) => (
            <div key={clip.id}>
              <button
                type="button"
                className={activeClip?.id === clip.id ? "is-active" : undefined}
                onClick={() => {
                  setCharacterFaceTrack(character.id, { clipId: clip.id, profile, enabled: true, loop: true });
                  playNormalCharacterAnimations(activeCharacterIds());
                }}
              >{clip.name}</button>
              <button type="button" aria-label={`删除 ${clip.name}`} onClick={() => deleteCharacterFaceClip(clip.id)}>删除</button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
