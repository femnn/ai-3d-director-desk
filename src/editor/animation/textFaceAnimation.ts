import type { CharacterFaceClip, CharacterFaceFrame } from "../schema/directorProject";
import { MEDIAPIPE_FACE_CHANNELS, createFaceClipChecksum } from "./characterFaceAnimation";

const TEXT_FACE_FPS = 30;
const MAX_TEXT_FACE_DURATION = 15;
export const MAX_TEXT_FACE_INPUT_LENGTH = 80;

type MouthShape = "closed" | "dental" | "funnel" | "open" | "round" | "wide";
type SpeechUnit = { end: number; shape: MouthShape; start: number };
type PinyinConverter = (text: string, options: { toneType: "none"; type: "array" }) => string[];

const SHAPE_VALUES: Record<MouthShape, Partial<Record<(typeof MEDIAPIPE_FACE_CHANNELS)[number], number>>> = {
  closed: { mouthClose: 0.9, mouthPressLeft: 0.28, mouthPressRight: 0.28 },
  dental: { jawOpen: 0.16, mouthLowerDownLeft: 0.2, mouthLowerDownRight: 0.2, mouthStretchLeft: 0.2, mouthStretchRight: 0.2 },
  funnel: { jawOpen: 0.28, mouthFunnel: 0.84, mouthPucker: 0.38 },
  open: { jawOpen: 0.78, mouthLowerDownLeft: 0.46, mouthLowerDownRight: 0.46 },
  round: { jawOpen: 0.45, mouthFunnel: 0.58, mouthPucker: 0.72 },
  wide: { jawOpen: 0.3, mouthStretchLeft: 0.68, mouthStretchRight: 0.68 },
};

const PINYIN_INITIAL = /^(zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])/u;

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

function initialShape(initial: string): MouthShape {
  if (/^(b|p|m)$/u.test(initial)) return "closed";
  if (initial === "f") return "funnel";
  if (/^(d|t|n|l|z|c|s|zh|ch|sh|r|j|q|x)$/u.test(initial)) return "dental";
  if (initial === "w") return "round";
  if (initial === "y") return "wide";
  return "open";
}

function finalShape(final: string): MouthShape {
  if (/^(u|uo|ou|ong|iong|ui|un)/u.test(final)) return "round";
  if (/^(ü|v|ue|ve)/u.test(final)) return "funnel";
  if (/^(i|ia|ie|iao|ian|iang|in|ing)/u.test(final)) return "wide";
  if (/^(o|e|ei|en|eng|er)/u.test(final)) return "funnel";
  return "open";
}

function appendUnit(units: SpeechUnit[], cursor: number, duration: number, shape: MouthShape) {
  units.push({ start: cursor, end: cursor + duration, shape });
  return cursor + duration;
}

function appendPinyinSyllable(units: SpeechUnit[], cursor: number, syllable: string) {
  const normalized = syllable.toLowerCase().replace(/[^a-züv]/gu, "");
  const initial = normalized.match(PINYIN_INITIAL)?.[0] ?? "";
  const final = normalized.slice(initial.length) || normalized;
  if (initial) cursor = appendUnit(units, cursor, 0.075, initialShape(initial));
  return appendUnit(units, cursor, initial ? 0.18 : 0.235, finalShape(final));
}

function appendLatinWord(units: SpeechUnit[], cursor: number, word: string) {
  const clusters = word.toLowerCase().match(/[aeiouy]+|[^aeiouy]+/gu) ?? [];
  clusters.forEach((cluster) => {
    const shape = /^[aeiouy]/u.test(cluster)
      ? finalShape(cluster)
      : initialShape(cluster.startsWith("th") ? "t" : cluster[0]);
    cursor = appendUnit(units, cursor, Math.min(0.16, 0.085 + cluster.length * 0.018), shape);
  });
  return cursor + 0.04;
}

function buildSpeechUnits(text: string, convertPinyin: PinyinConverter) {
  const units: SpeechUnit[] = [];
  let cursor = 0.14;
  tokenize(text).forEach((token) => {
    const pause = pauseDuration(token);
    if (pause > 0) {
      cursor += pause;
    } else if (/^[\p{Script=Han}]$/u.test(token)) {
      const syllable = convertPinyin(token, { toneType: "none", type: "array" })[0] ?? "a";
      cursor = appendPinyinSyllable(units, cursor, syllable);
    } else if (/^[A-Za-z]+$/u.test(token)) {
      cursor = appendLatinWord(units, cursor, token);
    } else {
      token.split("").forEach((digit) => {
        cursor = appendPinyinSyllable(units, cursor, ["ling", "yi", "er", "san", "si", "wu", "liu", "qi", "ba", "jiu"][Number(digit)] ?? "a");
      });
    }
  });
  return { units, rawDuration: units.length ? cursor + 0.18 : 0 };
}

function estimateSpeech(text: string) {
  let cursor = 0.14;
  let spokenUnits = 0;
  tokenize(text).forEach((token) => {
    const pause = pauseDuration(token);
    if (pause > 0) {
      cursor += pause;
    } else if (/^[\p{Script=Han}]$/u.test(token)) {
      cursor += 0.255;
      spokenUnits += 1;
    } else if (/^[A-Za-z]+$/u.test(token)) {
      const clusters = token.toLowerCase().match(/[aeiouy]+|[^aeiouy]+/gu) ?? [];
      cursor += clusters.reduce((total, cluster) => total + Math.min(0.16, 0.085 + cluster.length * 0.018), 0) + 0.04;
      spokenUnits += clusters.length;
    } else {
      cursor += token.length * 0.255;
      spokenUnits += token.length;
    }
  });
  return { rawDuration: spokenUnits ? cursor + 0.18 : 0, spokenUnits };
}

function durationBucket(rawDuration: number): 0 | 5 | 10 | 15 {
  if (rawDuration <= 0) return 0;
  if (rawDuration <= 5) return 5;
  if (rawDuration <= 10) return 10;
  return 15;
}

export function getTextFaceTiming(text: string) {
  const { rawDuration, spokenUnits } = estimateSpeech(text);
  return {
    duration: durationBucket(rawDuration),
    exceedsLimit: rawDuration > MAX_TEXT_FACE_DURATION,
    rawDuration,
    spokenUnits,
  };
}

export function estimateTextFaceDuration(text: string) {
  return getTextFaceTiming(text).duration;
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
      set(channel as (typeof MEDIAPIPE_FACE_CHANNELS)[number], (value ?? 0) * (0.42 + envelope * 0.58));
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

export async function createTextFaceClip(text: string, characterName: string): Promise<Omit<CharacterFaceClip, "id" | "characterId">> {
  const normalized = text.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!normalized) throw new Error("请输入需要表演的文字");
  const { pinyin } = await import("pinyin-pro");
  const { units, rawDuration } = buildSpeechUnits(normalized, pinyin);
  if (!units.length) throw new Error("文字中没有可生成口型的内容");
  if (rawDuration > MAX_TEXT_FACE_DURATION) throw new Error("文字超过15秒，请删减后再生成");
  const duration = durationBucket(rawDuration);
  const frames = Array.from({ length: duration * TEXT_FACE_FPS + 1 }, (_, index) =>
    createFrame(units, index / TEXT_FACE_FPS, duration, normalized)
  );
  const clip: Omit<CharacterFaceClip, "id" | "characterId"> = {
    name: `${characterName} 文字面部动画 ${duration}秒`,
    duration,
    fps: TEXT_FACE_FPS,
    channels: [...MEDIAPIPE_FACE_CHANNELS],
    frames,
    checksum: "",
  };
  clip.checksum = createFaceClipChecksum(clip);
  return clip;
}
