import { useRef, useState, type ChangeEvent } from "react";
import { FileVideo2, ImageUp } from "lucide-react";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { CharacterActionTrack, DirectorObject } from "../schema/directorProject";
import { MIN_CHARACTER_ACTION_DURATION, playNormalCharacterAnimations } from "../animation/characterAnimation";
import { useDirectorStore } from "../store/directorStore";
import { hasUsableUpperBodyPose, mapPoseLandmarksToControls, type PoseLandmarkSample } from "./poseMapping";

const MODEL_PATH = "/mediapipe/pose_landmarker_full.task";
const WASM_PATH = "/mediapipe/wasm";
const VIDEO_SAMPLE_FPS = 15;
const MAX_GAP_SECONDS = 0.35;

async function createLandmarker(runningMode: "IMAGE" | "VIDEO") {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  const options = {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" as const },
    runningMode,
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
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

function waitForMediaEvent(target: HTMLMediaElement, eventName: "loadedmetadata" | "loadeddata" | "seeked") {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(eventName, handleReady);
      target.removeEventListener("error", handleError);
    };
    const handleReady = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("无法读取视频文件"));
    };
    target.addEventListener(eventName, handleReady, { once: true });
    target.addEventListener("error", handleError, { once: true });
  });
}

async function seekVideo(video: HTMLVideoElement, time: number) {
  if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
  const ready = waitForMediaEvent(video, "seeked");
  video.currentTime = time;
  await ready;
}

export function smoothPoseControls(
  previous: Record<string, number> | null,
  current: Record<string, number>,
  alpha = 0.4
) {
  if (!previous) return { ...current };
  return Object.fromEntries(
    Object.entries(current).map(([key, value]) => [
      key,
      Number(((previous[key] ?? value) + (value - (previous[key] ?? value)) * alpha).toFixed(3)),
    ])
  );
}

async function analyzeVideo(
  file: File,
  onProgress: (progress: number) => void
) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  let landmarker: PoseLandmarker | null = null;
  try {
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) await waitForMediaEvent(video, "loadedmetadata");
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) await waitForMediaEvent(video, "loadeddata");
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error("视频时长无效");
    landmarker = await createLandmarker("VIDEO");
    const frameCount = Math.max(2, Math.ceil(video.duration * VIDEO_SAMPLE_FPS));
    const frames: Array<{ time: number; controls: Record<string, number> }> = [];
    let previousControls: Record<string, number> | null = null;
    let lastDetectedAt = -Infinity;
    for (let index = 0; index < frameCount; index += 1) {
      const time = Math.min(index / VIDEO_SAMPLE_FPS, Math.max(video.duration - 0.001, 0));
      await seekVideo(video, time);
      const result = landmarker.detectForVideo(video, Math.round(time * 1000));
      const landmarks = result.worldLandmarks[0] as PoseLandmarkSample[] | undefined;
      let controls: Record<string, number> | null = null;
      if (hasUsableUpperBodyPose(landmarks)) {
        controls = smoothPoseControls(previousControls, mapPoseLandmarksToControls(landmarks as PoseLandmarkSample[]));
        previousControls = controls;
        lastDetectedAt = time;
      } else if (previousControls && time - lastDetectedAt <= MAX_GAP_SECONDS) {
        controls = { ...previousControls };
      }
      if (controls) frames.push({ time: Number(time.toFixed(3)), controls });
      onProgress((index + 1) / frameCount);
    }
    if (frames.length < 2) throw new Error("视频中没有识别到连续的人体动作");
    return { duration: video.duration, frames };
  } finally {
    landmarker?.close();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function analyzeImage(file: File) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  let landmarker: PoseLandmarker | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("无法读取图片文件"));
      image.src = url;
    });
    landmarker = await createLandmarker("IMAGE");
    const result = landmarker.detect(image);
    const landmarks = result.worldLandmarks[0] as PoseLandmarkSample[] | undefined;
    if (!hasUsableUpperBodyPose(landmarks)) throw new Error("图片中没有识别到清晰的全身或上半身");
    return mapPoseLandmarksToControls(landmarks as PoseLandmarkSample[]);
  } finally {
    landmarker?.close();
    URL.revokeObjectURL(url);
  }
}

export function PoseVideoImporter({ character }: { character: DirectorObject }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  async function importVideo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || processing) return;
    setProcessing(true);
    setStatus("正在加载本地姿势模型");
    try {
      const analyzed = await analyzeVideo(file, (progress) => {
        setStatus(`正在提取视频动作 ${Math.round(progress * 100)}%`);
      });
      const store = useDirectorStore.getState();
      const clipId = store.addCharacterMotionClip({
        characterId: character.id,
        name: `${character.name}-${file.name.replace(/\.[^.]+$/, "")}`,
        duration: analyzed.duration,
        frames: analyzed.frames,
      });
      const track: CharacterActionTrack = {
        actionId: "idle",
        duration: Math.max(analyzed.duration, MIN_CHARACTER_ACTION_DURATION),
        loop: true,
        playbackMode: "normal",
        cameraId: null,
        enabled: true,
        source: "video",
        motionClipId: clipId,
      };
      store.setCharacterActionTrack(character.id, track);
      playNormalCharacterAnimations([character.id]);
      setStatus(`已提取 ${analyzed.frames.length} 帧动作并应用到 ${character.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "视频动作提取失败");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <section className="pose-media-importer" aria-label="视频动作导入">
      <button type="button" disabled={processing} onClick={() => inputRef.current?.click()}>
        <FileVideo2 aria-hidden="true" size={15} />
        {processing ? "正在分析视频" : "上传视频提取角色动作"}
      </button>
      <input ref={inputRef} hidden accept="video/*" type="file" onChange={(event) => void importVideo(event)} />
      {status ? <p>{status}</p> : null}
    </section>
  );
}

export function PoseImageImporter({ character }: { character: DirectorObject }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  async function importImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || processing) return;
    setProcessing(true);
    setStatus("正在识别图片姿势");
    try {
      const controls = await analyzeImage(file);
      const store = useDirectorStore.getState();
      store.setCharacterActionTrack(character.id, null);
      store.replacePoseControls(character.id, controls);
      setStatus(`已将图片姿势应用到 ${character.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "图片姿势识别失败");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <section className="pose-media-importer" aria-label="图片姿势导入">
      <button type="button" disabled={processing} onClick={() => inputRef.current?.click()}>
        <ImageUp aria-hidden="true" size={15} />
        {processing ? "正在识别图片" : "导入全身图套用姿势"}
      </button>
      <input ref={inputRef} hidden accept="image/*" type="file" onChange={(event) => void importImage(event)} />
      {status ? <p>{status}</p> : null}
    </section>
  );
}
