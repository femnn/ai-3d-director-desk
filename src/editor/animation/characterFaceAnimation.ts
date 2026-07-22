import type {
  CharacterFaceClip,
  CharacterFaceFrame,
  CharacterFaceProfile,
} from "../schema/directorProject";
import { Matrix4, Quaternion, Vector3 } from "three";

export const MEDIAPIPE_FACE_CHANNELS = [
  "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
  "cheekPuff", "cheekSquintLeft", "cheekSquintRight", "eyeBlinkLeft", "eyeBlinkRight",
  "eyeLookDownLeft", "eyeLookDownRight", "eyeLookInLeft", "eyeLookInRight", "eyeLookOutLeft",
  "eyeLookOutRight", "eyeLookUpLeft", "eyeLookUpRight", "eyeSquintLeft", "eyeSquintRight",
  "eyeWideLeft", "eyeWideRight", "jawForward", "jawLeft", "jawOpen", "jawRight",
  "mouthClose", "mouthDimpleLeft", "mouthDimpleRight", "mouthFrownLeft", "mouthFrownRight",
  "mouthFunnel", "mouthLeft", "mouthLowerDownLeft", "mouthLowerDownRight", "mouthPressLeft",
  "mouthPressRight", "mouthPucker", "mouthRight", "mouthRollLower", "mouthRollUpper",
  "mouthShrugLower", "mouthShrugUpper", "mouthSmileLeft", "mouthSmileRight", "mouthStretchLeft",
  "mouthStretchRight", "mouthUpperUpLeft", "mouthUpperUpRight", "noseSneerLeft", "noseSneerRight",
  "tongueOut",
] as const;

const FACECAP_MAP: Record<string, string> = {
  browDownLeft: "browDown_L", browDownRight: "browDown_R", browInnerUp: "browInnerUp",
  browOuterUpLeft: "browOuterUp_L", browOuterUpRight: "browOuterUp_R", cheekPuff: "cheekPuff",
  cheekSquintLeft: "cheekSquint_L", cheekSquintRight: "cheekSquint_R", eyeBlinkLeft: "eyeBlink_L",
  eyeBlinkRight: "eyeBlink_R", eyeLookDownLeft: "eyeLookDown_L", eyeLookDownRight: "eyeLookDown_R",
  eyeLookInLeft: "eyeLookIn_L", eyeLookInRight: "eyeLookIn_R", eyeLookOutLeft: "eyeLookOut_L",
  eyeLookOutRight: "eyeLookOut_R", eyeLookUpLeft: "eyeLookUp_L", eyeLookUpRight: "eyeLookUp_R",
  eyeSquintLeft: "eyeSquint_L", eyeSquintRight: "eyeSquint_R", eyeWideLeft: "eyeWide_L",
  eyeWideRight: "eyeWide_R", jawForward: "jawForward", jawLeft: "jawLeft", jawOpen: "jawOpen",
  jawRight: "jawRight", mouthClose: "mouthClose", mouthDimpleLeft: "mouthDimple_L",
  mouthDimpleRight: "mouthDimple_R", mouthFrownLeft: "mouthFrown_L", mouthFrownRight: "mouthFrown_R",
  mouthFunnel: "mouthFunnel", mouthLeft: "mouthLeft", mouthLowerDownLeft: "mouthLowerDown_L",
  mouthLowerDownRight: "mouthLowerDown_R", mouthPressLeft: "mouthPress_L", mouthPressRight: "mouthPress_R",
  mouthPucker: "mouthPucker", mouthRight: "mouthRight", mouthRollLower: "mouthRollLower",
  mouthRollUpper: "mouthRollUpper", mouthShrugLower: "mouthShrugLower", mouthShrugUpper: "mouthShrugUpper",
  mouthSmileLeft: "mouthSmile_L", mouthSmileRight: "mouthSmile_R", mouthStretchLeft: "mouthStretch_L",
  mouthStretchRight: "mouthStretch_R", mouthUpperUpLeft: "mouthUpperUp_L",
  mouthUpperUpRight: "mouthUpperUp_R", noseSneerLeft: "noseSneer_L", noseSneerRight: "noseSneer_R",
  tongueOut: "tongueOut",
};

export interface CharacterFaceSample {
  influences: Record<string, number>;
  headRotation: [number, number, number, number];
}

export const NEUTRAL_CHARACTER_FACE_SAMPLE: CharacterFaceSample = {
  influences: {},
  headRotation: [0, 0, 0, 1],
};

function clamp01(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function normalizeQuaternion(values: number[]): [number, number, number, number] {
  const length = Math.hypot(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 1) || 1;
  return [
    (values[0] ?? 0) / length,
    (values[1] ?? 0) / length,
    (values[2] ?? 0) / length,
    (values[3] ?? 1) / length,
  ];
}

function interpolateFrame(left: CharacterFaceFrame, right: CharacterFaceFrame, time: number): CharacterFaceFrame {
  const span = Math.max(0.001, right.time - left.time);
  const amount = Math.min(1, Math.max(0, (time - left.time) / span));
  const count = Math.max(left.values.length, right.values.length);
  const quaternion = normalizeQuaternion([0, 1, 2, 3].map((index) =>
    (left.headRotation[index] ?? (index === 3 ? 1 : 0))
      + ((right.headRotation[index] ?? (index === 3 ? 1 : 0)) - (left.headRotation[index] ?? (index === 3 ? 1 : 0))) * amount
  ));
  return {
    time,
    values: Array.from({ length: count }, (_, index) => {
      const start = left.values[index] ?? 0;
      return start + ((right.values[index] ?? start) - start) * amount;
    }),
    headRotation: quaternion,
  };
}

export function sampleCharacterFaceFrame(clip: CharacterFaceClip, elapsed: number, loop = true): CharacterFaceFrame {
  if (!clip.frames.length) return { time: 0, values: [], headRotation: [0, 0, 0, 1] };
  const duration = Math.max(0.001, clip.duration);
  const time = loop
    ? ((elapsed % duration) + duration) % duration
    : Math.min(duration, Math.max(0, elapsed));
  let low = 0;
  let high = clip.frames.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (clip.frames[middle].time < time) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return { ...clip.frames[0], time };
  const right = clip.frames[low];
  const left = clip.frames[low - 1];
  return interpolateFrame(left, right, time);
}

function toLookup(clip: CharacterFaceClip, frame: CharacterFaceFrame) {
  return Object.fromEntries(clip.channels.map((name, index) => [name, clamp01(frame.values[index] ?? 0)]));
}

export function mapFaceInfluences(profile: CharacterFaceProfile, values: Record<string, number>) {
  if (profile === "facecap52") {
    return Object.fromEntries(Object.entries(FACECAP_MAP).map(([source, target]) => [target, clamp01(values[source] ?? 0)]));
  }
  const maximum = (...names: string[]) => Math.max(0, ...names.map((name) => values[name] ?? 0));
  const average = (...names: string[]) => names.reduce((sum, name) => sum + (values[name] ?? 0), 0) / names.length;
  return {
    surprise: clamp01(Math.max((values.browInnerUp ?? 0) * 0.7, average("eyeWideLeft", "eyeWideRight") * 0.62)),
    disgust: clamp01(maximum("noseSneerLeft", "noseSneerRight", "mouthFrownLeft", "mouthFrownRight")),
    suck: clamp01(maximum("mouthFunnel", "mouthPucker") * 0.75),
    // These GNM semantic targets deform the whole head. Speech mouth shapes
    // must never drive them or the avatar visibly pulses in scale.
    compress_face: 0,
    stretch_face: 0,
    happy: clamp01(average("mouthSmileLeft", "mouthSmileRight") + average("cheekSquintLeft", "cheekSquintRight") * 0.35),
    squint: clamp01(maximum("eyeSquintLeft", "eyeSquintRight")),
    platysma: clamp01(average("mouthFrownLeft", "mouthFrownRight", "jawOpen") * 0.45),
    blow: clamp01(values.cheekPuff ?? 0), funneler: clamp01(values.mouthFunnel ?? 0),
    smile_wide: clamp01(average("mouthSmileLeft", "mouthSmileRight") + average("mouthStretchLeft", "mouthStretchRight") * 0.55),
    corners_down: clamp01(average("mouthFrownLeft", "mouthFrownRight")), pucker: clamp01(values.mouthPucker ?? 0),
    wink_left: clamp01(values.eyeBlinkLeft ?? 0), wink_right: clamp01(values.eyeBlinkRight ?? 0),
    mouth_left: clamp01(values.mouthLeft ?? 0), mouth_right: clamp01(values.mouthRight ?? 0),
    lips_roll_in: clamp01(Math.max(
      average("mouthRollLower", "mouthRollUpper"),
      (values.mouthClose ?? 0) * 0.62,
      average("mouthPressLeft", "mouthPressRight") * 0.38
    )),
    snarl: clamp01(maximum("noseSneerLeft", "noseSneerRight")), tongue_center: clamp01(values.tongueOut ?? 0),
    jaw_open: clamp01(values.jawOpen ?? 0),
  };
}

export function sampleCharacterFaceClip(
  clip: CharacterFaceClip,
  profile: CharacterFaceProfile,
  elapsed: number,
  loop = true
): CharacterFaceSample {
  const frame = sampleCharacterFaceFrame(clip, elapsed, loop);
  return {
    influences: mapFaceInfluences(profile, toLookup(clip, frame)),
    headRotation: frame.headRotation,
  };
}

export function createFaceClipChecksum(clip: Pick<CharacterFaceClip, "channels" | "frames" | "duration">) {
  const source = `${clip.duration}|${clip.channels.join("|")}|${clip.frames.map((frame) =>
    `${frame.time}:${frame.values.join(",")}:${frame.headRotation.join(",")}`
  ).join(";")}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `face_${(hash >>> 0).toString(16)}`;
}

export function getRelativeHeadRotation(matrix: number[], neutralMatrix?: number[] | null): [number, number, number, number] {
  if (matrix.length !== 16 || matrix.some((value) => !Number.isFinite(value))) return [0, 0, 0, 1];
  const current = new Quaternion();
  new Matrix4().fromArray(matrix).decompose(new Vector3(), current, new Vector3());
  if (neutralMatrix?.length === 16 && neutralMatrix.every(Number.isFinite)) {
    const neutral = new Quaternion();
    new Matrix4().fromArray(neutralMatrix).decompose(new Vector3(), neutral, new Vector3());
    current.premultiply(neutral.invert());
  }
  current.normalize();
  return [current.x, current.y, current.z, current.w];
}
