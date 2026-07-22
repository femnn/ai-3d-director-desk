import type { CharacterFaceClip, CharacterFaceFrame } from "../schema/directorProject";
import { MEDIAPIPE_FACE_CHANNELS, createFaceClipChecksum } from "./characterFaceAnimation";

const TEXT_FACE_FPS = 30;
const MAX_TEXT_FACE_DURATION = 60;

type SpeechUnit = {
  end: number;
  shape: MouthShape;
  start: number;
};

type MouthShape = "closed" | "funnel" | "open" | "round" | "wide";

const SHAPE_VALUES: Record<MouthShape, Partial<Record<(typeof MEDIAPIPE_FACE_CHANNELS)[number], number>>> = {
  closed: { mouthClose: 0.78, mouthPressLeft: 0.35, mouthPressRight: 0.35 },
  funnel: { jawOpen: 0.28, mouthFunnel: 0.82, mouthPucker: 0.42 },
  open: { jawOpen: 0.72, mouthLowerDownLeft: 0.42, mouthLowerDownRight: 0.42 },
  round: { jawOpen: 0.46, mouthFunnel: 0.5, mouthPucker: 0.68 },
  wide: { jawOpen: 0.32, mouthStretchLeft: 0.62, mouthStretchRight: 0.62 },
};

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function tokenize(text: string) {
  return text.normalize("NFKC").trim().match(/[\p{Script=Han}]|[A-Za-z]+|\d+|[，。！？、,.!?;；:：…]+/gu) ?? [];
}

function pauseDuration(token: string) {
  if (/[。！？.!?]/u.test(token)) return 0.42;
  if (/[，、,;；:：…]/u.test(token)) return 0.22;
  return 0;
}

function spokenDuration(token: string) {
  if (/^[\p{Script=Han}]$/u.test(token)) return 0.235;
  if (/^\d+$/u.test(token)) return 0.15 * token.length + 0.08;
  return 0.24 + Math.min(0.52, token.length * 0.055);
}

function mouthShapeForToken(token: string): MouthShape {
  const lower = token.toLowerCase();
  if (/^[bmp]/u.test(lower)) return "closed";
  if (/[oquw]/u.test(lower)) return "round";
  if (/[fv]/u.test(lower)) return "funnel";
  if (/[eiy]/u.test(lower)) return "wide";
  if (/^[\p{Script=Han}]$/u.test(token)) {
    return (["open", "wide", "round", "funnel", "closed"] as MouthShape[])[token.codePointAt(0)! % 5];
  }
  return "open";
}

function buildSpeechUnits(text: string) {
  const units: SpeechUnit[] = [];
  let cursor = 0.16;
  tokenize(text).forEach((token) => {
    const pause = pauseDuration(token);
    if (pause > 0) {
      cursor += pause;
      return;
    }
    const duration = spokenDuration(token);
    units.push({ start: cursor, end: cursor + duration, shape: mouthShapeForToken(token) });
    cursor += duration;
  });
  return { units, duration: Math.min(MAX_TEXT_FACE_DURATION, Math.max(0.8, cursor + 0.2)) };
}

export function estimateTextFaceDuration(text: string) {
  return Number(buildSpeechUnits(text).duration.toFixed(1));
}

function shapeAt(units: SpeechUnit[], time: number) {
  return units.find((unit) => time >= unit.start && time <= unit.end) ?? null;
}

function createFrame(units: SpeechUnit[], time: number, duration: number, text: string): CharacterFaceFrame {
  const values = MEDIAPIPE_FACE_CHANNELS.map(() => 0);
  const set = (channel: (typeof MEDIAPIPE_FACE_CHANNELS)[number], value: number) => {
    const index = MEDIAPIPE_FACE_CHANNELS.indexOf(channel);
    if (index >= 0) values[index] = clamp01(value);
  };
  const unit = shapeAt(units, time);
  if (unit) {
    const phase = (time - unit.start) / Math.max(0.001, unit.end - unit.start);
    const envelope = Math.sin(Math.PI * clamp01(phase));
    Object.entries(SHAPE_VALUES[unit.shape]).forEach(([channel, value]) => {
      set(channel as (typeof MEDIAPIPE_FACE_CHANNELS)[number], (value ?? 0) * (0.35 + envelope * 0.65));
    });
  }
  const blinkPhase = time % 3.1;
  if (blinkPhase > 2.98) {
    const blink = Math.sin(((blinkPhase - 2.98) / 0.12) * Math.PI);
    set("eyeBlinkLeft", blink);
    set("eyeBlinkRight", blink * 0.96);
  }
  if (text.includes("？") || text.includes("?")) set("browInnerUp", 0.18 * Math.sin(Math.PI * time / duration) ** 2);
  if (text.includes("！") || text.includes("!")) {
    set("browOuterUpLeft", 0.16);
    set("browOuterUpRight", 0.16);
  }
  return { time: Number(time.toFixed(4)), values: values.map((value) => Number(value.toFixed(4))), headRotation: [0, 0, 0, 1] };
}

export function createTextFaceClip(text: string, characterName: string): Omit<CharacterFaceClip, "id" | "characterId"> {
  const normalized = text.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!normalized) throw new Error("请输入需要表演的文字");
  const { units, duration } = buildSpeechUnits(normalized);
  if (!units.length) throw new Error("文字中没有可生成口型的内容");
  const frames = Array.from({ length: Math.ceil(duration * TEXT_FACE_FPS) + 1 }, (_, index) =>
    createFrame(units, Math.min(duration, index / TEXT_FACE_FPS), duration, normalized)
  );
  const clip: Omit<CharacterFaceClip, "id" | "characterId"> = {
    name: `${characterName} 文字面部动画 ${duration.toFixed(1)}秒`,
    duration,
    fps: TEXT_FACE_FPS,
    channels: [...MEDIAPIPE_FACE_CHANNELS],
    frames,
    checksum: "",
  };
  clip.checksum = createFaceClipChecksum(clip);
  return clip;
}
