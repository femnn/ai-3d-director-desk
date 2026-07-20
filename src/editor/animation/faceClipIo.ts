import type { CharacterFaceClip, CharacterFaceFrame } from "../schema/directorProject";
import {
  MEDIAPIPE_FACE_CHANNELS,
  createFaceClipChecksum,
  getRelativeHeadRotation,
} from "./characterFaceAnimation";

export interface FaceAnimationPackage {
  format: "storyai-face-animation";
  version: 1;
  clip: Omit<CharacterFaceClip, "id" | "characterId">;
}

function finite(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function exportFaceAnimationPackage(clip: CharacterFaceClip): FaceAnimationPackage {
  const { id: _id, characterId: _characterId, ...portable } = clip;
  return { format: "storyai-face-animation", version: 1, clip: portable };
}

function parseStoryAiPackage(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const payload = value as Partial<FaceAnimationPackage>;
  if (payload.format !== "storyai-face-animation" || payload.version !== 1 || !payload.clip) return null;
  const clip = payload.clip as Partial<FaceAnimationPackage["clip"]>;
  if (!Array.isArray(clip.channels) || !clip.channels.length || !Array.isArray(clip.frames) || !clip.frames.length) {
    throw new Error("面部动画包缺少通道或帧数据");
  }
  const channels = clip.channels.filter((channel): channel is string => typeof channel === "string" && channel.length > 0);
  const frames: CharacterFaceFrame[] = clip.frames.map((frame) => ({
    time: Math.max(0, finite(frame.time)),
    values: channels.map((_, index) => Math.min(1, Math.max(0, finite(frame.values?.[index])))),
    headRotation: Array.isArray(frame.headRotation) && frame.headRotation.length === 4
      ? frame.headRotation.map((entry) => finite(entry)) as [number, number, number, number]
      : [0, 0, 0, 1],
  }));
  const duration = Math.max(0.1, finite(clip.duration, frames[frames.length - 1].time));
  const portable: Omit<CharacterFaceClip, "id" | "characterId"> = {
    name: typeof clip.name === "string" && clip.name.trim() ? clip.name : "导入面部动画",
    duration,
    fps: Math.min(120, Math.max(1, finite(clip.fps, 30))),
    channels,
    frames,
    checksum: typeof clip.checksum === "string" ? clip.checksum : "",
  };
  portable.checksum ||= createFaceClipChecksum(portable);
  return portable;
}

function parseGnmMotion(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (payload.format !== "gnm-studio-motion" || (payload.version !== 1 && payload.version !== 2)) return null;
  if (!Array.isArray(payload.frames) || !payload.frames.length) throw new Error("GNM 动作文件没有帧数据");
  const neutral = payload.neutral && typeof payload.neutral === "object" ? payload.neutral as Record<string, unknown> : null;
  const neutralScores = new Map<string, number>();
  if (Array.isArray(neutral?.blendshapes)) {
    neutral.blendshapes.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const shape = entry as Record<string, unknown>;
      if (typeof shape.name === "string") neutralScores.set(shape.name, finite(shape.score));
    });
  }
  const neutralMatrix = Array.isArray(neutral?.matrix) ? neutral.matrix.map((entry) => finite(entry)) : null;
  const firstTimestamp = finite((payload.frames[0] as Record<string, unknown>).timestamp);
  const frames: CharacterFaceFrame[] = payload.frames.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("GNM 动作帧格式无效");
    const frame = entry as Record<string, unknown>;
    const blendshapes = frame.blendshapes && typeof frame.blendshapes === "object" && !Array.isArray(frame.blendshapes)
      ? frame.blendshapes as Record<string, unknown>
      : {};
    const matrix = Array.isArray(frame.matrix) ? frame.matrix.map((item) => finite(item)) : [];
    return {
      time: Math.max(0, (finite(frame.timestamp) - firstTimestamp) / 1000),
      values: MEDIAPIPE_FACE_CHANNELS.map((name) =>
        Math.min(1, Math.max(0, finite(blendshapes[name]) - (neutralScores.get(name) ?? 0)))
      ),
      headRotation: getRelativeHeadRotation(matrix, neutralMatrix),
    };
  });
  const duration = Math.max(0.1, frames[frames.length - 1].time);
  const clip: Omit<CharacterFaceClip, "id" | "characterId"> = {
    name: "GNM Studio 面部动画",
    duration,
    fps: Math.min(120, Math.max(1, finite(payload.fps, 30))),
    channels: [...MEDIAPIPE_FACE_CHANNELS],
    frames,
    checksum: "",
  };
  clip.checksum = createFaceClipChecksum(clip);
  return clip;
}

export function parseFaceAnimationFile(value: unknown): Omit<CharacterFaceClip, "id" | "characterId"> {
  const storyAi = parseStoryAiPackage(value);
  if (storyAi) return storyAi;
  const gnm = parseGnmMotion(value);
  if (gnm) return gnm;
  throw new Error("仅支持 storyai-face-animation 或 gnm-studio-motion JSON");
}
