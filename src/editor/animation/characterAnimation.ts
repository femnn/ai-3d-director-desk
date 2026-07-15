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
  { id: "light-dance", label: "Codex 轻快舞" },
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
};

const LIGHT_DANCE_BASE_CONTROLS: Record<string, number> = {
  "body.pitch": 0,
  "body.yaw": 0,
  "body.roll": 0,
  "body.offsetY": 0,
  "torso.pitch": 0,
  "torso.yaw": 0,
  "torso.roll": 0,
  "head.pitch": 0,
  "head.yaw": 0,
  "head.roll": 0,
  "leftShoulder.pitch": 0,
  "leftShoulder.spread": 0,
  "leftShoulder.twist": 0,
  "rightShoulder.pitch": 0,
  "rightShoulder.spread": 0,
  "rightShoulder.twist": 0,
  "leftElbow.bend": 0,
  "rightElbow.bend": 0,
  "leftHand.pitch": 0,
  "leftHand.roll": 0,
  "rightHand.pitch": 0,
  "rightHand.roll": 0,
  "leftHip.pitch": 0,
  "leftHip.spread": 0,
  "leftHip.twist": 0,
  "rightHip.pitch": 0,
  "rightHip.spread": 0,
  "rightHip.twist": 0,
  "leftKnee.bend": 0,
  "rightKnee.bend": 0,
  "leftFoot.pitch": 0,
  "leftFoot.roll": 0,
  "rightFoot.pitch": 0,
  "rightFoot.roll": 0,
};

// Five seconds of text-directed choreography: side steps, knee lifts,
// diagonal reaches, an overhead accent, a crouched bounce, and a cross-body finish.
const LIGHT_DANCE_POSES: TimedDancePose[] = [
  {
    time: 0,
    controls: {
      "body.yaw": -8, "body.roll": -5, "body.offsetY": -0.04, "torso.yaw": 7, "head.yaw": 5,
      "leftShoulder.pitch": -16, "leftShoulder.spread": -8, "leftElbow.bend": 22,
      "rightShoulder.pitch": 34, "rightShoulder.spread": 30, "rightShoulder.twist": -12, "rightElbow.bend": 66,
      "rightHand.roll": -18, "leftHip.pitch": -10, "leftHip.spread": -8,
      "rightHip.pitch": 18, "rightHip.spread": 12, "leftKnee.bend": 10, "rightKnee.bend": 30,
    },
  },
  {
    time: 0.1,
    controls: {
      "body.yaw": 10, "body.roll": 7, "body.offsetY": -0.08, "torso.yaw": -10, "head.yaw": -7,
      "leftShoulder.pitch": 38, "leftShoulder.spread": -32, "leftShoulder.twist": 12, "leftElbow.bend": 64,
      "rightShoulder.pitch": -18, "rightShoulder.spread": 8, "rightElbow.bend": 20,
      "leftHip.pitch": 20, "leftHip.spread": -12, "rightHip.pitch": -12, "rightHip.spread": 7,
      "leftKnee.bend": 32, "rightKnee.bend": 12,
    },
  },
  {
    time: 0.2,
    controls: {
      "body.pitch": -5, "body.yaw": -6, "body.roll": -8, "body.offsetY": -0.12, "torso.yaw": 12,
      "head.pitch": -4, "head.yaw": 8, "leftShoulder.pitch": -28, "leftShoulder.spread": -18,
      "leftElbow.bend": 28, "rightShoulder.pitch": 54, "rightShoulder.spread": 18, "rightElbow.bend": 58,
      "leftHip.pitch": 48, "leftHip.spread": -14, "leftKnee.bend": 68,
      "rightHip.pitch": 8, "rightHip.spread": 10, "rightKnee.bend": 14, "leftFoot.pitch": -18,
    },
  },
  {
    time: 0.3,
    controls: {
      "body.yaw": 14, "body.roll": 5, "torso.yaw": -16, "torso.roll": 5, "head.yaw": -10,
      "leftShoulder.pitch": -20, "leftShoulder.spread": -20, "leftElbow.bend": 52,
      "rightShoulder.pitch": 72, "rightShoulder.spread": 52, "rightShoulder.twist": -18,
      "rightElbow.bend": 12, "rightHand.roll": 14, "leftHip.pitch": -8, "rightHip.pitch": 24,
      "leftKnee.bend": 16, "rightKnee.bend": 38,
    },
  },
  {
    time: 0.4,
    controls: {
      "body.pitch": -4, "body.offsetY": -0.18, "torso.pitch": 8, "head.pitch": -8,
      "leftShoulder.pitch": 78, "leftShoulder.spread": -48, "leftShoulder.twist": 12, "leftElbow.bend": 18,
      "rightShoulder.pitch": 78, "rightShoulder.spread": 48, "rightShoulder.twist": -12, "rightElbow.bend": 18,
      "leftHand.roll": -14, "rightHand.roll": 14, "leftHip.pitch": 28, "rightHip.pitch": 28,
      "leftHip.spread": -16, "rightHip.spread": 16, "leftKnee.bend": 46, "rightKnee.bend": 46,
    },
  },
  {
    time: 0.5,
    controls: {
      "body.pitch": 6, "body.offsetY": -0.28, "torso.pitch": -9, "head.pitch": 7,
      "leftShoulder.pitch": -18, "leftShoulder.spread": -30, "leftElbow.bend": 58,
      "rightShoulder.pitch": -18, "rightShoulder.spread": 30, "rightElbow.bend": 58,
      "leftHip.pitch": 38, "rightHip.pitch": 38, "leftHip.spread": -18, "rightHip.spread": 18,
      "leftKnee.bend": 62, "rightKnee.bend": 62, "leftFoot.pitch": 10, "rightFoot.pitch": 10,
    },
  },
  {
    time: 0.6,
    controls: {
      "body.yaw": -16, "body.roll": -7, "body.offsetY": -0.06, "torso.yaw": 18, "head.yaw": 10,
      "leftShoulder.pitch": 48, "leftShoulder.spread": -72, "leftShoulder.twist": 10, "leftElbow.bend": 14,
      "rightShoulder.pitch": 18, "rightShoulder.spread": 8, "rightShoulder.twist": -24, "rightElbow.bend": 72,
      "leftHip.pitch": 20, "leftHip.spread": -14, "rightHip.pitch": -12, "rightHip.spread": 8,
      "leftKnee.bend": 34, "rightKnee.bend": 12,
    },
  },
  {
    time: 0.7,
    controls: {
      "body.pitch": -5, "body.yaw": 20, "body.roll": 6, "body.offsetY": -0.1, "torso.yaw": -20,
      "head.yaw": -12, "leftShoulder.pitch": -36, "leftShoulder.spread": -12, "leftElbow.bend": 30,
      "rightShoulder.pitch": 42, "rightShoulder.spread": 34, "rightElbow.bend": 42,
      "leftHip.pitch": -18, "rightHip.pitch": 32, "leftKnee.bend": 14, "rightKnee.bend": 48,
      "rightFoot.pitch": -16,
    },
  },
  {
    time: 0.8,
    controls: {
      "body.yaw": -14, "body.roll": -5, "torso.yaw": 24, "head.yaw": 12,
      "leftShoulder.pitch": 70, "leftShoulder.spread": 18, "leftShoulder.twist": 16, "leftElbow.bend": 16,
      "rightShoulder.pitch": 26, "rightShoulder.spread": 12, "rightShoulder.twist": -24, "rightElbow.bend": 78,
      "leftHip.pitch": 10, "leftHip.spread": -10, "rightHip.pitch": 20, "rightHip.spread": 14,
      "leftKnee.bend": 18, "rightKnee.bend": 34,
    },
  },
  {
    time: 0.9,
    controls: {
      "body.pitch": -6, "body.yaw": 8, "body.roll": 8, "body.offsetY": -0.13, "torso.yaw": -12,
      "head.pitch": -5, "head.yaw": -8, "leftShoulder.pitch": 38, "leftShoulder.spread": -24,
      "leftElbow.bend": 62, "rightShoulder.pitch": 58, "rightShoulder.spread": 24, "rightElbow.bend": 54,
      "leftHip.pitch": 8, "leftKnee.bend": 16, "rightHip.pitch": 50, "rightHip.spread": 14,
      "rightKnee.bend": 70, "rightFoot.pitch": -20,
    },
  },
  {
    time: 1,
    controls: {
      "body.yaw": -8, "body.roll": -5, "body.offsetY": -0.04, "torso.yaw": 7, "head.yaw": 5,
      "leftShoulder.pitch": -16, "leftShoulder.spread": -8, "leftElbow.bend": 22,
      "rightShoulder.pitch": 34, "rightShoulder.spread": 30, "rightShoulder.twist": -12, "rightElbow.bend": 66,
      "rightHand.roll": -18, "leftHip.pitch": -10, "leftHip.spread": -8,
      "rightHip.pitch": 18, "rightHip.spread": 12, "leftKnee.bend": 10, "rightKnee.bend": 30,
    },
  },
];

function smoothstep(value: number) {
  const clamped = clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function sampleLightDanceControls(elapsed: number, duration: number) {
  const safeDuration = Math.max(duration, MIN_CHARACTER_ACTION_DURATION);
  const progress = (((elapsed % safeDuration) + safeDuration) % safeDuration) / safeDuration;
  const foundIndex = LIGHT_DANCE_POSES.findIndex((pose) => pose.time >= progress);
  const nextIndex = Math.max(1, foundIndex === -1 ? LIGHT_DANCE_POSES.length - 1 : foundIndex);
  const previous = LIGHT_DANCE_POSES[nextIndex - 1];
  const next = LIGHT_DANCE_POSES[nextIndex];
  const mix = smoothstep((progress - previous.time) / Math.max(next.time - previous.time, 0.0001));
  const keys = new Set([...Object.keys(LIGHT_DANCE_BASE_CONTROLS), ...Object.keys(previous.controls), ...Object.keys(next.controls)]);
  const controls: Record<string, number> = {};
  keys.forEach((key) => {
    const start = previous.controls[key] ?? LIGHT_DANCE_BASE_CONTROLS[key] ?? 0;
    const end = next.controls[key] ?? LIGHT_DANCE_BASE_CONTROLS[key] ?? 0;
    controls[key] = Number((start + (end - start) * mix).toFixed(3));
  });
  const rhythm = Math.sin(progress * Math.PI * 8);
  controls["body.offsetY"] = Number(((controls["body.offsetY"] ?? 0) - Math.abs(rhythm) * 0.025).toFixed(3));
  controls["head.roll"] = Number(((controls["head.roll"] ?? 0) - rhythm * 2.5).toFixed(3));
  return controls;
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
    const phase = getPhase(elapsed, duration);
    return [
      Number((Math.sin(phase) * 0.18).toFixed(4)),
      Number((Math.max(Math.sin(phase * 4), 0) * 0.045).toFixed(4)),
      Number((Math.sin(phase * 2) * 0.07).toFixed(4)),
    ];
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
  return Math.max(typeof duration === "number" && Number.isFinite(duration) ? duration : MIN_CHARACTER_ACTION_DURATION, MIN_CHARACTER_ACTION_DURATION);
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
