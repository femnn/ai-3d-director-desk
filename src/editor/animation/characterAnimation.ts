import { useMemo, useSyncExternalStore } from "react";
import { MANNEQUIN_POSE_PRESETS } from "../presets/mannequinPosePresets";
import type { CharacterActionId, CharacterActionTrack, CharacterMotionClip, CharacterRigState, DirectorObject } from "../schema/directorProject";
import { sampleCharacterMotionClip } from "./characterMotionClip";

type Tuple3 = [number, number, number];

export const CHARACTER_ACTION_OPTIONS: Array<{ id: CharacterActionId; label: string }> = [
  { id: "still", label: "原地不动" },
  { id: "idle", label: "站立呼吸" },
  { id: "sit", label: "坐下等待" },
  { id: "drink-tea", label: "喝茶" },
  { id: "talk", label: "交谈手势" },
  { id: "walk", label: "向前行走" },
  { id: "run", label: "向前跑步" },
  { id: "turn", label: "转身" },
  { id: "look", label: "注视" },
  { id: "wave", label: "招手" },
  { id: "bow", label: "鞠躬" },
  { id: "think", label: "思考" },
  { id: "reach", label: "伸手" },
  { id: "push", label: "双手推进" },
  { id: "fight", label: "格斗" },
  { id: "dance", label: "舞动" },
  { id: "light-dance", label: "Codex 轻快舞（15秒）" },
  { id: "phone", label: "看手机" },
];

export const MIN_CHARACTER_ACTION_DURATION = 5;

type CameraSample = {
  position: Tuple3;
  target: Tuple3;
  fov: number;
  time: number;
};

type CameraDriver = {
  lastSample: CameraSample | null;
  active: boolean;
  characterIds: string[];
  lastMovementAt: number;
};

const ANIMATION_FRAME_RATE = 30;
const ANIMATION_FRAME_INTERVAL_MS = 1000 / ANIMATION_FRAME_RATE;
const CAMERA_MOVEMENT_HOLD_MS = 200;
const MAX_CATCH_UP_STEPS = 1;

const listeners = new Set<() => void>();
const elapsedByCharacterId = new Map<string, number>();
const cameraDrivers = new Map<string, CameraDriver>();
let revision = 0;
let normalCharacterIds = new Set<string>();
let runtimeFrame = 0;
let runtimeLastAt = 0;
let runtimeAccumulator = 0;

function emit() {
  revision += 1;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return revision;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getPresetControls(id: string) {
  return MANNEQUIN_POSE_PRESETS.find((preset) => preset.id === id)?.controls ?? {};
}

function getPhase(elapsed: number, duration: number) {
  return ((elapsed % Math.max(duration, MIN_CHARACTER_ACTION_DURATION)) / Math.max(duration, MIN_CHARACTER_ACTION_DURATION)) * Math.PI * 2;
}

type TimedDancePose = {
  time: number;
  controls: Record<string, number>;
  root: Tuple3;
};

type DancePoseParts = {
  body?: [number, number, number, number];
  torso?: [number, number, number];
  head?: [number, number, number];
  leftArm?: [number, number, number, number, number?, number?];
  rightArm?: [number, number, number, number, number?, number?];
  leftLeg?: [number, number, number, number, number?, number?];
  rightLeg?: [number, number, number, number, number?, number?];
  root?: Tuple3;
};

export const LIGHT_DANCE_DURATION_SECONDS = 15;

export function getDefaultCharacterActionDuration(actionId: CharacterActionId | undefined) {
  return actionId === "light-dance" ? LIGHT_DANCE_DURATION_SECONDS : MIN_CHARACTER_ACTION_DURATION;
}

const LIGHT_DANCE_NEUTRAL_CONTROLS: Record<string, number> = {
  "body.pitch": 0,
  "body.yaw": 0,
  "body.roll": 0,
  "body.offsetY": -0.03,
  "torso.pitch": 0,
  "torso.yaw": 0,
  "torso.roll": 0,
  "head.pitch": 0,
  "head.yaw": 0,
  "head.roll": 0,
  "leftShoulder.pitch": 0,
  "leftShoulder.spread": -4,
  "leftShoulder.twist": 0,
  "rightShoulder.pitch": 0,
  "rightShoulder.spread": 4,
  "rightShoulder.twist": 0,
  "leftElbow.bend": 12,
  "rightElbow.bend": 12,
  "leftHand.pitch": 0,
  "leftHand.roll": 0,
  "rightHand.pitch": 0,
  "rightHand.roll": 0,
  "leftHip.pitch": 0,
  "leftHip.spread": -4,
  "leftHip.twist": 0,
  "rightHip.pitch": 0,
  "rightHip.spread": 4,
  "rightHip.twist": 0,
  "leftKnee.bend": 8,
  "rightKnee.bend": 8,
  "leftFoot.pitch": 0,
  "leftFoot.roll": 0,
  "rightFoot.pitch": 0,
  "rightFoot.roll": 0,
};

function createDancePose(seconds: number, parts: DancePoseParts): TimedDancePose {
  const controls = { ...LIGHT_DANCE_NEUTRAL_CONTROLS };
  const assignBody = (prefix: "body" | "torso" | "head", values: number[] | undefined) => {
    if (!values) return;
    controls[`${prefix}.pitch`] = values[0] ?? 0;
    controls[`${prefix}.yaw`] = values[1] ?? 0;
    controls[`${prefix}.roll`] = values[2] ?? 0;
    if (prefix === "body" && values[3] !== undefined) controls["body.offsetY"] = values[3];
  };
  const assignArm = (side: "left" | "right", values: DancePoseParts["leftArm"]) => {
    if (!values) return;
    controls[`${side}Shoulder.pitch`] = values[0];
    controls[`${side}Shoulder.spread`] = values[1];
    controls[`${side}Shoulder.twist`] = values[2];
    controls[`${side}Elbow.bend`] = values[3];
    controls[`${side}Hand.pitch`] = values[4] ?? 0;
    controls[`${side}Hand.roll`] = values[5] ?? 0;
  };
  const assignLeg = (side: "left" | "right", values: DancePoseParts["leftLeg"]) => {
    if (!values) return;
    controls[`${side}Hip.pitch`] = values[0];
    controls[`${side}Hip.spread`] = values[1];
    controls[`${side}Hip.twist`] = values[2];
    controls[`${side}Knee.bend`] = values[3];
    controls[`${side}Foot.pitch`] = values[4] ?? 0;
    controls[`${side}Foot.roll`] = values[5] ?? 0;
  };
  assignBody("body", parts.body);
  assignBody("torso", parts.torso);
  assignBody("head", parts.head);
  assignArm("left", parts.leftArm);
  assignArm("right", parts.rightArm);
  assignLeg("left", parts.leftLeg);
  assignLeg("right", parts.rightLeg);
  return { time: seconds / LIGHT_DANCE_DURATION_SECONDS, controls, root: parts.root ?? [0, 0, 0] };
}

// Choreography follows the reference clip at half-second landmarks. The pose
// sequence is sampled with a continuous cardinal spline so the body does not
// stop at every beat.
const LIGHT_DANCE_POSES: TimedDancePose[] = [
  createDancePose(0, { body: [0, -6, -4, -0.05], torso: [0, 8, 2], head: [0, 5, -2], leftArm: [42, -34, 14, 88, 8, -12], rightArm: [44, 34, -14, 86, 8, 12], leftLeg: [28, -10, 0, 58, -12, -6], rightLeg: [-4, 7, 0, 12], root: [-0.05, 0, 0] }),
  createDancePose(0.5, { body: [0, 5, 4, -0.04], torso: [0, -8, -3], head: [0, -4, 2], leftArm: [-12, -8, 14, 42, 0, -16], rightArm: [66, 18, -18, 98, 12, 18], leftLeg: [-8, -8, 0, 16], rightLeg: [18, 8, 0, 34, -10], root: [0.06, 0, 0.02] }),
  createDancePose(1, { body: [-3, 12, 7, -0.12], torso: [3, -15, -5], head: [-2, -8, 2], leftArm: [-22, -10, 18, 20], rightArm: [54, 22, -20, 72, 8, 16], leftLeg: [22, -12, 0, 42, -10], rightLeg: [-12, 8, 0, 18], root: [0.14, 0, 0.05] }),
  createDancePose(1.5, { body: [0, -5, -4, -0.09], torso: [0, 9, 3], head: [0, 6, -2], leftArm: [-10, -8, 10, 18], rightArm: [58, 10, -24, 96, 10, 20], leftLeg: [-12, -5, 0, 18], rightLeg: [24, 10, 0, 44, -12], root: [0.02, 0, 0.02] }),
  createDancePose(2, { body: [0, -12, -6, -0.07], torso: [0, 14, 5], head: [0, 8, -2], leftArm: [-14, -10, 16, 26], rightArm: [48, 16, -20, 88, 4, 18], leftLeg: [18, -10, 0, 34, -8], rightLeg: [-10, 6, 0, 16], root: [-0.12, 0, 0] }),
  createDancePose(2.5, { body: [0, 6, 7, -0.05], torso: [0, -12, -5], head: [0, -7, 3], leftArm: [-12, -10, 8, 18], rightArm: [86, 56, -16, 22, 0, 12], leftLeg: [-6, -8, 0, 14], rightLeg: [18, 12, 0, 32], root: [-0.02, 0, 0] }),
  createDancePose(3, { body: [-2, 0, -4, -0.03], torso: [0, 4, 2], head: [-3, 3, -2], leftArm: [-8, -12, 8, 20], rightArm: [108, 34, -12, 12, -6, 8], leftLeg: [12, -18, 0, 22], rightLeg: [8, 18, 0, 18], root: [0.06, 0, 0] }),
  createDancePose(3.5, { body: [-2, -5, 3, -0.05], torso: [0, 8, -2], head: [-2, 5, 2], leftArm: [18, -54, 8, 20], rightArm: [112, 28, -14, 12, -8, 8], leftLeg: [5, -20, 0, 18], rightLeg: [16, 20, 0, 28], root: [0.12, 0, 0] }),
  createDancePose(4, { body: [-5, 0, 0, -0.15], torso: [6, 0, 0], head: [-6, 0, 0], leftArm: [112, -30, 12, 54, -8, -12], rightArm: [112, 30, -12, 54, -8, 12], leftLeg: [28, -15, 0, 44, 8], rightLeg: [28, 15, 0, 44, 8], root: [0.05, 0, -0.02] }),
  createDancePose(4.5, { body: [-2, 4, 3, -0.23], torso: [4, -6, -2], head: [0, -4, 2], leftArm: [96, -18, 8, 70, 4, -8], rightArm: [96, 18, -8, 70, 4, 8], leftLeg: [40, -16, 0, 66, 10], rightLeg: [40, 16, 0, 66, 10], root: [0.02, 0, -0.05] }),
  createDancePose(5, { body: [4, -4, -3, -0.32], torso: [-7, 6, 2], head: [5, 4, -2], leftArm: [76, -9, 18, 96, 6, -4], rightArm: [76, 9, -18, 96, 6, 4], leftLeg: [48, -17, 0, 82, 12], rightLeg: [48, 17, 0, 82, 12], root: [0, 0, -0.07] }),
  createDancePose(5.5, { body: [7, 8, 5, -0.22], torso: [-8, -10, -4], head: [4, -6, 2], leftArm: [-28, -36, 10, 24], rightArm: [-28, 36, -10, 24], leftLeg: [34, -15, 0, 58, 8], rightLeg: [30, 15, 0, 52, 8], root: [0.08, 0, -0.05] }),
  createDancePose(6, { body: [0, 14, 6, -0.08], torso: [0, -18, -4], head: [0, -10, 2], leftArm: [34, -76, 8, 18, 0, -6], rightArm: [-8, 12, -16, 36], leftLeg: [-12, -8, 0, 16], rightLeg: [24, 10, 0, 42, -12], root: [0.16, 0, 0] }),
  createDancePose(6.5, { body: [0, -12, -5, -0.05], torso: [0, 16, 4], head: [0, 9, -2], leftArm: [40, -72, 10, 16], rightArm: [-12, 10, -12, 24], leftLeg: [22, -10, 0, 38, -10], rightLeg: [-10, 8, 0, 16], root: [0.03, 0, 0.03] }),
  createDancePose(7, { body: [0, -22, -4, -0.06], torso: [0, 28, 3], head: [0, 14, -2], leftArm: [64, -24, 18, 70, 4, -8], rightArm: [20, 10, -18, 64], leftLeg: [-8, -6, 0, 14], rightLeg: [24, 8, 0, 42], root: [-0.09, 0, 0.02] }),
  createDancePose(7.5, { body: [0, -35, 3, -0.04], torso: [0, 24, -3], head: [0, 18, 2], leftArm: [-10, -8, 10, 18], rightArm: [-12, 8, -10, 18], leftLeg: [18, -8, 0, 34, -8], rightLeg: [-8, 6, 0, 14], root: [-0.15, 0, 0] }),
  createDancePose(8, { body: [0, -8, -2, -0.03], torso: [0, 8, 2], head: [0, 5, -2], leftArm: [-4, -8, 8, 18], rightArm: [-4, 8, -8, 18], leftLeg: [-6, -6, 0, 14], rightLeg: [16, 8, 0, 32, -8], root: [-0.06, 0, 0] }),
  createDancePose(8.5, { body: [-2, 8, 5, -0.1], torso: [2, -12, -4], head: [-2, -7, 2], leftArm: [62, -20, 16, 84, 8, -8], rightArm: [38, 14, -16, 76, 4, 10], leftLeg: [44, -12, 0, 72, -18], rightLeg: [-8, 8, 0, 16], root: [0.08, 0, 0.03] }),
  createDancePose(9, { body: [5, 18, 7, -0.08], torso: [-4, -22, -5], head: [0, -10, 3], leftArm: [-34, -28, 8, 18], rightArm: [-24, 30, -8, 20], leftLeg: [-18, -8, 0, 18], rightLeg: [30, 12, 0, 52, -14], root: [0.18, 0, 0.08] }),
  createDancePose(9.5, { body: [-4, -6, -5, -0.08], torso: [3, 10, 3], head: [-6, 8, -2], leftArm: [68, -12, 20, 96, 12, -12], rightArm: [-20, 18, -12, 26], leftLeg: [-8, -7, 0, 14], rightLeg: [62, 10, 0, 34, -24], root: [0.03, 0, 0.08] }),
  createDancePose(10, { body: [2, 30, 4, -0.07], torso: [-2, -32, -3], head: [0, -16, 2], leftArm: [18, -66, 6, 18], rightArm: [12, 62, -6, 18], leftLeg: [24, -12, 0, 42], rightLeg: [-8, 10, 0, 16], root: [-0.1, 0, 0.03] }),
  createDancePose(10.5, { body: [0, 12, -4, -0.08], torso: [0, -16, 4], head: [0, -8, -2], leftArm: [22, -78, 8, 14], rightArm: [22, 78, -8, 14], leftLeg: [-8, -8, 0, 16], rightLeg: [24, 10, 0, 40], root: [-0.17, 0, 0] }),
  createDancePose(11, { body: [-2, -18, -5, -0.1], torso: [2, 24, 4], head: [0, 12, -2], leftArm: [70, -12, 20, 92, 4, -8], rightArm: [62, 12, -20, 86, 4, 8], leftLeg: [24, -12, 0, 42], rightLeg: [-10, 8, 0, 18], root: [-0.08, 0, -0.03] }),
  createDancePose(11.5, { body: [0, 12, 5, -0.06], torso: [0, -16, -4], head: [0, -8, 2], leftArm: [-18, -24, 10, 22], rightArm: [88, 6, -14, 18, -6, 8], leftLeg: [-8, -8, 0, 16], rightLeg: [22, 10, 0, 38], root: [0.06, 0, 0] }),
  createDancePose(12, { body: [0, -10, -4, -0.08], torso: [0, 14, 4], head: [0, 8, -2], leftArm: [76, -8, 18, 84, 4, -8], rightArm: [28, 14, -18, 72], leftLeg: [22, -10, 0, 38], rightLeg: [-8, 8, 0, 16], root: [-0.04, 0, 0.02] }),
  createDancePose(12.5, { body: [-3, 3, 3, -0.16], torso: [4, -5, -2], head: [-2, -3, 2], leftArm: [72, -26, 18, 92, 8, -10], rightArm: [72, 26, -18, 92, 8, 10], leftLeg: [34, -14, 0, 58, 8], rightLeg: [34, 14, 0, 58, 8], root: [0.03, 0, 0] }),
  createDancePose(13, { body: [4, -3, -2, -0.29], torso: [-6, 5, 2], head: [4, 3, -2], leftArm: [82, -10, 18, 104, 8, -6], rightArm: [82, 10, -18, 104, 8, 6], leftLeg: [48, -16, 0, 82, 12], rightLeg: [48, 16, 0, 82, 12], root: [0, 0, -0.04] }),
  createDancePose(13.5, { body: [2, 5, 4, -0.36], torso: [-3, -7, -3], head: [3, -4, 2], leftArm: [94, -24, 14, 78, 2, -8], rightArm: [94, 24, -14, 78, 2, 8], leftLeg: [56, -18, 0, 94, 14], rightLeg: [56, 18, 0, 94, 14], root: [0.04, 0, -0.07] }),
  createDancePose(14, { body: [-4, -8, -6, -0.08], torso: [4, 10, 4], head: [-4, 6, -2], leftArm: [108, -28, 14, 48, -6, -10], rightArm: [106, 28, -14, 52, -6, 10], leftLeg: [52, -14, 0, 82, -20], rightLeg: [-6, 8, 0, 16], root: [-0.07, 0, 0.02] }),
  createDancePose(14.5, { body: [0, 10, 8, -0.06], torso: [0, -14, -6], head: [0, -8, 3], leftArm: [78, -24, 18, 94, 8, -12], rightArm: [76, 24, -18, 92, 8, 12], leftLeg: [-8, -8, 0, 16], rightLeg: [28, 10, 0, 48, -12], root: [0.07, 0, 0.02] }),
  createDancePose(15, { body: [0, -6, -4, -0.05], torso: [0, 8, 2], head: [0, 5, -2], leftArm: [42, -34, 14, 88, 8, -12], rightArm: [44, 34, -14, 86, 8, 12], leftLeg: [28, -10, 0, 58, -12, -6], rightLeg: [-4, 7, 0, 12], root: [-0.05, 0, 0] }),
];

function cardinalSpline(p0: number, p1: number, p2: number, p3: number, amount: number, tension = 0.32) {
  const t = clamp(amount, 0, 1);
  const t2 = t * t;
  const t3 = t2 * t;
  const tangentScale = (1 - tension) / 2;
  const m1 = (p2 - p0) * tangentScale;
  const m2 = (p3 - p1) * tangentScale;
  return (2 * t3 - 3 * t2 + 1) * p1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2 + (t3 - t2) * m2;
}

function getLightDanceSample(elapsed: number, duration: number) {
  const safeDuration = Math.max(duration, LIGHT_DANCE_DURATION_SECONDS);
  const progress = (((elapsed % safeDuration) + safeDuration) % safeDuration) / safeDuration;
  const foundIndex = LIGHT_DANCE_POSES.findIndex((pose) => pose.time > progress);
  const nextIndex = Math.max(1, foundIndex === -1 ? LIGHT_DANCE_POSES.length - 1 : foundIndex);
  const previousIndex = nextIndex - 1;
  const uniquePoseCount = LIGHT_DANCE_POSES.length - 1;
  const beforeIndex = previousIndex === 0 ? uniquePoseCount - 1 : previousIndex - 1;
  const afterIndex = nextIndex === LIGHT_DANCE_POSES.length - 1 ? 1 : nextIndex + 1;
  const before = LIGHT_DANCE_POSES[beforeIndex];
  const previous = LIGHT_DANCE_POSES[previousIndex];
  const next = LIGHT_DANCE_POSES[nextIndex];
  const after = LIGHT_DANCE_POSES[afterIndex];
  const mix = (progress - previous.time) / Math.max(next.time - previous.time, 0.0001);
  const controls: Record<string, number> = {};
  Object.keys(LIGHT_DANCE_NEUTRAL_CONTROLS).forEach((key) => {
    const value = cardinalSpline(before.controls[key], previous.controls[key], next.controls[key], after.controls[key], mix);
    const constrained = key.endsWith(".bend")
      ? clamp(value, 0, 135)
      : key === "body.offsetY"
        ? clamp(value, -0.45, 0.05)
        : clamp(value, -120, 120);
    controls[key] = Number(constrained.toFixed(3));
  });
  const rhythm = Math.sin(progress * Math.PI * 30);
  controls["body.offsetY"] = Number(((controls["body.offsetY"] ?? 0) - Math.abs(rhythm) * 0.012).toFixed(3));
  controls["torso.roll"] = Number(((controls["torso.roll"] ?? 0) + rhythm * 1.2).toFixed(3));
  controls["head.roll"] = Number(((controls["head.roll"] ?? 0) - rhythm * 1.4).toFixed(3));
  const root = previous.root.map((_, index) =>
    Number(cardinalSpline(before.root[index], previous.root[index], next.root[index], after.root[index], mix, 0.38).toFixed(4))
  ) as Tuple3;
  return { controls, root };
}

function sampleLightDanceControls(elapsed: number, duration: number) {
  return getLightDanceSample(elapsed, duration).controls;
}

function getActionControls(actionId: CharacterActionId, elapsed: number, duration: number): Record<string, number> {
  const phase = getPhase(elapsed, duration);
  const breath = Math.sin(phase) * 2;
  const stride = Math.sin(phase * 2);

  switch (actionId) {
    case "still":
      return {};
    case "sit":
      return { ...getPresetControls("sit"), "torso.pitch": -8 + breath * 0.35, "head.yaw": Math.sin(phase * 0.5) * 3 };
    case "drink-tea":
      return {
        ...getPresetControls("sit"),
        "head.pitch": 6 + Math.max(Math.sin(phase), 0) * 8,
        "rightShoulder.pitch": 14 + Math.max(Math.sin(phase), 0) * 36,
        "rightShoulder.twist": -28,
        "rightElbow.bend": 78 + Math.max(Math.sin(phase), 0) * 16,
        "leftShoulder.pitch": 8,
        "leftElbow.bend": 22,
      };
    case "talk":
      return {
        "body.yaw": Math.sin(phase * 0.5) * 6,
        "torso.yaw": Math.sin(phase) * 8,
        "head.yaw": Math.sin(phase * 0.8) * 12,
        "leftShoulder.pitch": 12 + Math.sin(phase * 1.6) * 18,
        "rightShoulder.pitch": 12 - Math.sin(phase * 1.6) * 18,
        "leftElbow.bend": 30 + Math.max(Math.sin(phase * 1.6), 0) * 45,
        "rightElbow.bend": 30 + Math.max(-Math.sin(phase * 1.6), 0) * 45,
      };
    case "walk":
      return {
        "leftShoulder.pitch": stride * 32,
        "rightShoulder.pitch": -stride * 32,
        "leftHip.pitch": -stride * 30,
        "rightHip.pitch": stride * 30,
        "leftKnee.bend": Math.max(stride, 0) * 30,
        "rightKnee.bend": Math.max(-stride, 0) * 30,
        "body.offsetY": Math.abs(stride) * -0.04,
      };
    case "run":
      return {
        "body.pitch": -9,
        "leftShoulder.pitch": stride * 52,
        "rightShoulder.pitch": -stride * 52,
        "leftHip.pitch": -stride * 48,
        "rightHip.pitch": stride * 48,
        "leftKnee.bend": Math.max(stride, 0) * 48,
        "rightKnee.bend": Math.max(-stride, 0) * 48,
        "body.offsetY": Math.abs(stride) * -0.07,
      };
    case "turn":
      return {
        "body.yaw": Math.sin(phase) * 38,
        "torso.yaw": Math.sin(phase) * 16,
        "head.yaw": Math.sin(phase) * 22,
        "leftShoulder.pitch": 8,
        "rightShoulder.pitch": -8,
      };
    case "look":
      return {
        "head.yaw": Math.sin(phase * 0.65) * 28,
        "head.pitch": Math.sin(phase * 0.5) * 6,
        "torso.yaw": Math.sin(phase * 0.65) * 6,
      };
    case "wave":
      return {
        ...getPresetControls("wave"),
        "rightHand.roll": -18 + Math.sin(phase * 4) * 34,
        "rightHand.pitch": 12 + Math.sin(phase * 2) * 10,
        "head.yaw": Math.sin(phase * 0.5) * 5,
      };
    case "bow":
      return {
        ...getPresetControls("bow"),
        "body.pitch": -12 - Math.max(Math.sin(phase), 0) * 42,
        "head.pitch": 8 + Math.max(Math.sin(phase), 0) * 18,
      };
    case "think":
      return {
        ...getPresetControls("think"),
        "head.yaw": Math.sin(phase * 0.65) * 14,
        "torso.yaw": Math.sin(phase * 0.65) * 5,
        "rightElbow.bend": 80 + Math.sin(phase) * 8,
      };
    case "reach":
      return {
        ...getPresetControls("reach"),
        "rightShoulder.pitch": 38 + Math.max(Math.sin(phase), 0) * 42,
        "rightElbow.bend": 18 + Math.max(-Math.sin(phase), 0) * 42,
        "body.pitch": Math.sin(phase) * 8,
      };
    case "push":
      return {
        ...getPresetControls("push"),
        "body.pitch": 2 + Math.max(Math.sin(phase), 0) * 16,
        "leftShoulder.pitch": 58 + Math.max(Math.sin(phase), 0) * 28,
        "rightShoulder.pitch": 58 + Math.max(Math.sin(phase), 0) * 28,
      };
    case "fight":
      return {
        ...getPresetControls("fight"),
        "body.yaw": Math.sin(phase) * 14,
        "leftShoulder.pitch": 42 + Math.max(Math.sin(phase * 2), 0) * 42,
        "rightShoulder.pitch": 30 + Math.max(-Math.sin(phase * 2), 0) * 48,
        "leftElbow.bend": 68 + Math.max(Math.sin(phase * 2), 0) * 20,
        "rightElbow.bend": 68 + Math.max(-Math.sin(phase * 2), 0) * 20,
      };
    case "dance":
      return {
        "body.yaw": Math.sin(phase) * 24,
        "body.roll": Math.sin(phase * 2) * 10,
        "torso.pitch": Math.sin(phase * 2) * 8,
        "head.yaw": Math.sin(phase) * 18,
        "leftShoulder.pitch": Math.sin(phase * 2) * 54,
        "rightShoulder.pitch": -Math.sin(phase * 2) * 54,
        "leftHip.pitch": -Math.sin(phase * 2) * 24,
        "rightHip.pitch": Math.sin(phase * 2) * 24,
      };
    case "light-dance":
      return sampleLightDanceControls(elapsed, duration);
    case "phone":
      return {
        ...getPresetControls("phone"),
        "head.pitch": 14 + Math.sin(phase * 0.7) * 6,
        "rightHand.roll": -30 + Math.sin(phase * 1.4) * 8,
        "leftHand.pitch": -8 + Math.sin(phase * 1.4) * 6,
      };
    case "idle":
    default:
      return { "torso.pitch": breath * 0.4, "body.roll": Math.sin(phase * 0.5) * 1.2, "head.yaw": Math.sin(phase * 0.35) * 2 };
  }
}

function getActionRootOffset(actionId: CharacterActionId, elapsed: number, duration: number): Tuple3 {
  if (actionId === "light-dance") {
    return getLightDanceSample(elapsed, duration).root;
  }
  if (actionId !== "walk" && actionId !== "run") return [0, 0, 0];
  const stride = Math.sin(getPhase(elapsed, duration) * 2);
  const speed = actionId === "run" ? 0.9 : 0.42;
  // The mannequin faces local +Z. Root motion completes once per selected action segment,
  // then holds its final position so a looping gait cannot drift through the entire set.
  const distance = Math.min(Math.max(elapsed, 0), Math.max(duration, MIN_CHARACTER_ACTION_DURATION)) * speed;
  return [0, Math.abs(stride) * -0.015, Number(distance.toFixed(4))];
}

export function getActionTrackDuration(track: CharacterActionTrack | undefined) {
  const duration = track?.duration;
  const minimum = getDefaultCharacterActionDuration(track?.actionId);
  return Math.max(typeof duration === "number" && Number.isFinite(duration) ? duration : minimum, minimum);
}

export function getCharacterActionRigState(
  object: DirectorObject,
  elapsed: number,
  motionClip?: CharacterMotionClip
): CharacterRigState | undefined {
  const rig = object.characterRig;
  const track = object.characterActionTrack;
  if (!rig || !track?.enabled) return rig;

  return {
    ...rig,
    controls: {
      ...rig.controls,
      ...(track.motionClipId && motionClip
        ? sampleCharacterMotionClip(motionClip, elapsed, track.source === "video" || Boolean(track.loop))
        : getActionControls(track.actionId, elapsed, getActionTrackDuration(track))),
    },
  };
}

export function getCharacterActionRootOffset(object: DirectorObject, elapsed: number): Tuple3 {
  const track = object.characterActionTrack;
  if (!track?.enabled) return [0, 0, 0];
  return getActionRootOffset(track.actionId, elapsed, getActionTrackDuration(track));
}

export function getCharacterActionElapsed(characterId: string) {
  return elapsedByCharacterId.get(characterId) ?? 0;
}

export function getCharacterAnimationElapsedSnapshot() {
  return Object.fromEntries(Array.from(elapsedByCharacterId.entries()).map(([id, elapsed]) => [id, Number(elapsed.toFixed(4))]));
}

export function setCharacterAnimationElapsedSnapshot(snapshot: Record<string, number> | null | undefined) {
  const nextEntries = Object.entries(snapshot ?? {}).filter(([, elapsed]) => typeof elapsed === "number" && Number.isFinite(elapsed));
  elapsedByCharacterId.clear();
  nextEntries.forEach(([id, elapsed]) => elapsedByCharacterId.set(id, elapsed));
  emit();
}

export function subscribeCharacterAnimationRuntime(listener: () => void) {
  return subscribe(listener);
}

function advanceCharacters(characterIds: Iterable<string>, deltaSeconds: number, shouldEmit = true) {
  const safeDelta = clamp(deltaSeconds, 0, 0.1);
  if (safeDelta <= 0) return;
  for (const characterId of characterIds) {
    elapsedByCharacterId.set(characterId, (elapsedByCharacterId.get(characterId) ?? 0) + safeDelta);
  }
  if (shouldEmit) emit();
}

function hasActiveCameraDrivers() {
  return Array.from(cameraDrivers.values()).some((driver) => driver.active && driver.characterIds.length > 0);
}

function ensureRuntimeFrame() {
  if (runtimeFrame || typeof window === "undefined") return;
  runtimeLastAt = performance.now();
  runtimeAccumulator = 0;
  runtimeFrame = window.requestAnimationFrame(tickRuntime);
}

function tickRuntime(now: number) {
  runtimeFrame = 0;
  const activeCharacterIds = new Set(normalCharacterIds);
  let activityChanged = false;

  cameraDrivers.forEach((driver) => {
    if (driver.active && now - driver.lastMovementAt > CAMERA_MOVEMENT_HOLD_MS) {
      driver.active = false;
      activityChanged = true;
    }
    if (driver.active) driver.characterIds.forEach((id) => activeCharacterIds.add(id));
  });

  if (activeCharacterIds.size === 0) {
    runtimeLastAt = now;
    runtimeAccumulator = 0;
    if (activityChanged) emit();
    return;
  }

  // Fixed animation steps keep the captured canvas cadence stable. Limiting catch-up
  // prevents a busy render frame from making characters visibly jump forward.
  runtimeAccumulator += clamp(now - runtimeLastAt, 0, ANIMATION_FRAME_INTERVAL_MS * MAX_CATCH_UP_STEPS);
  runtimeLastAt = now;
  let steps = 0;
  while (runtimeAccumulator >= ANIMATION_FRAME_INTERVAL_MS && steps < MAX_CATCH_UP_STEPS) {
    advanceCharacters(activeCharacterIds, 1 / ANIMATION_FRAME_RATE, false);
    runtimeAccumulator -= ANIMATION_FRAME_INTERVAL_MS;
    steps += 1;
  }
  if (steps > 0 || activityChanged) emit();
  runtimeFrame = window.requestAnimationFrame(tickRuntime);
}

export function playNormalCharacterAnimations(characterIds: string[]) {
  normalCharacterIds = new Set(characterIds);
  characterIds.forEach((id) => elapsedByCharacterId.set(id, 0));
  ensureRuntimeFrame();
  emit();
}

export function syncNormalCharacterAnimations(characterIds: string[]) {
  normalCharacterIds = new Set(characterIds);
  characterIds.forEach((id) => {
    if (!elapsedByCharacterId.has(id)) elapsedByCharacterId.set(id, 0);
  });
  ensureRuntimeFrame();
  emit();
}

export function stopNormalCharacterAnimations() {
  normalCharacterIds.clear();
  if (runtimeFrame && !hasActiveCameraDrivers()) window.cancelAnimationFrame(runtimeFrame);
  if (!hasActiveCameraDrivers()) runtimeFrame = 0;
  emit();
}

export function isNormalCharacterAnimationPlaying() {
  return normalCharacterIds.size > 0;
}

export function beginCameraDrivenCharacterAnimations(cameraId: string, characterIds: string[]) {
  if (!cameraId) return;
  const existing = cameraDrivers.get(cameraId);
  if (existing) {
    existing.characterIds = characterIds;
    return;
  }
  characterIds.forEach((id) => elapsedByCharacterId.set(id, 0));
  cameraDrivers.set(cameraId, { lastSample: null, active: false, characterIds, lastMovementAt: 0 });
  emit();
}

export function reportCameraDrivenCharacterMovement(cameraId: string, sample: CameraSample) {
  const driver = cameraDrivers.get(cameraId);
  if (!driver) return;
  const previous = driver.lastSample;
  driver.lastSample = sample;
  if (!previous) return;

  const positionDelta = Math.hypot(
    sample.position[0] - previous.position[0],
    sample.position[1] - previous.position[1],
    sample.position[2] - previous.position[2]
  );
  const targetDelta = Math.hypot(
    sample.target[0] - previous.target[0],
    sample.target[1] - previous.target[1],
    sample.target[2] - previous.target[2]
  );
  const fovDelta = Math.abs(sample.fov - previous.fov);
  const moved = positionDelta > 0.002 || targetDelta > 0.003 || fovDelta > 0.04;
  if (!moved) return;
  const wasActive = driver.active;
  driver.active = true;
  driver.lastMovementAt = performance.now();
  // Start on a deterministic frame instead of using the irregular network packet delta.
  if (!wasActive) advanceCharacters(driver.characterIds, 1 / ANIMATION_FRAME_RATE);
  ensureRuntimeFrame();
}

export function endCameraDrivenCharacterAnimations(cameraId: string) {
  if (!cameraDrivers.delete(cameraId)) return;
  if (runtimeFrame && normalCharacterIds.size === 0 && !hasActiveCameraDrivers()) {
    window.cancelAnimationFrame(runtimeFrame);
    runtimeFrame = 0;
  }
  emit();
}

export function isCameraDrivingCharacterAnimations(cameraId: string) {
  return cameraDrivers.get(cameraId)?.active ?? false;
}

export function useAnimatedCharacterRigState(object: DirectorObject, motionClip?: CharacterMotionClip) {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const elapsed = getCharacterActionElapsed(object.id);
  return useMemo(
    () => ({
      rigState: getCharacterActionRigState(object, elapsed, motionClip),
      rootOffset: getCharacterActionRootOffset(object, elapsed),
      elapsed,
    }),
    [elapsed, motionClip, object]
  );
}
