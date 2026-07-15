import { useSyncExternalStore } from "react";
import type {
  CharacterMotionClip,
  CharacterRigState,
  DirectorAnimationSequence,
  DirectorAnimationSequenceTrack,
  DirectorCharacterAnimationTrack,
  DirectorObject,
  DirectorObjectAnimationTrack,
  DirectorTransform,
} from "../schema/directorProject";
import { getActionControls, getActionRootOffset } from "./characterAnimation";
import { sampleCharacterMotionFrame } from "./characterMotionClip";
import { sampleObjectAnimation } from "./objectAnimation";

type Tuple3 = [number, number, number];
type CameraSample = { position: Tuple3; target: Tuple3; fov: number; time: number };

export interface AnimationSequenceRuntimeSnapshot {
  sequenceId: string | null;
  elapsed: number;
  playing: boolean;
  recording: boolean;
  cameraMoving: boolean;
  cameraId: string | null;
}

const CAMERA_MOVEMENT_HOLD_MS = 200;
const POSITION_START_THRESHOLD = 0.004;
const TARGET_START_THRESHOLD = 0.006;
const FOV_START_THRESHOLD = 0.06;
const MAX_FRAME_DELTA_SECONDS = 1 / 30;

const EMPTY_RUNTIME: AnimationSequenceRuntimeSnapshot = {
  sequenceId: null,
  elapsed: 0,
  playing: false,
  recording: false,
  cameraMoving: false,
  cameraId: null,
};

let runtime = EMPTY_RUNTIME;
let activeSequence: DirectorAnimationSequence | null = null;
let runtimeFrame = 0;
let lastFrameAt = 0;
let lastMovementAt = 0;
let lastCameraSample: CameraSample | null = null;
let manualPreview = false;
let lastRuntimeNotifyAt = 0;
const listeners = new Set<() => void>();

function emit(patch: Partial<AnimationSequenceRuntimeSnapshot>) {
  runtime = { ...runtime, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function subscribeAnimationSequenceRuntime(listener: () => void) {
  return subscribe(listener);
}

export function getAnimationSequenceRuntimeSnapshot() {
  return runtime;
}

export function useAnimationSequenceRuntime() {
  return useSyncExternalStore(subscribe, getAnimationSequenceRuntimeSnapshot, getAnimationSequenceRuntimeSnapshot);
}

function stopRuntimeFrame() {
  if (runtimeFrame && typeof window !== "undefined") window.cancelAnimationFrame(runtimeFrame);
  runtimeFrame = 0;
}

function finishAtSequenceEnd(sequence: DirectorAnimationSequence) {
  if (sequence.loop) return 0;
  emit({ elapsed: sequence.duration, playing: false, cameraMoving: false });
  return sequence.duration;
}

function tick(now: number) {
  runtimeFrame = 0;
  const sequence = activeSequence;
  if (!sequence || !runtime.playing) return;

  const rawDelta = lastFrameAt ? (now - lastFrameAt) / 1000 : 0;
  const delta = Math.min(Math.max(rawDelta, 0), MAX_FRAME_DELTA_SECONDS);
  lastFrameAt = now;
  const cameraMoving = sequence.playbackMode === "camera-motion"
    ? runtime.recording && lastMovementAt > 0 && now - lastMovementAt <= CAMERA_MOVEMENT_HOLD_MS
    : false;
  const shouldAdvance = manualPreview || sequence.playbackMode !== "camera-motion" || cameraMoving;
  let elapsed = runtime.elapsed;
  if (shouldAdvance) elapsed += delta;
  if (elapsed >= sequence.duration) {
    elapsed = sequence.loop ? elapsed % sequence.duration : finishAtSequenceEnd(sequence);
  }
  if (runtime.playing) {
    runtime = { ...runtime, elapsed: Number(elapsed.toFixed(4)), cameraMoving };
    if (now - lastRuntimeNotifyAt >= 1000 / 30) {
      lastRuntimeNotifyAt = now;
      listeners.forEach((listener) => listener());
    }
    runtimeFrame = window.requestAnimationFrame(tick);
  }
}

function ensureRuntimeFrame() {
  if (runtimeFrame || typeof window === "undefined" || !runtime.playing) return;
  lastFrameAt = performance.now();
  runtimeFrame = window.requestAnimationFrame(tick);
}

export function playAnimationSequence(sequence: DirectorAnimationSequence, options: { reset?: boolean } = {}) {
  activeSequence = sequence;
  manualPreview = true;
  const reset = options.reset ?? runtime.sequenceId !== sequence.id;
  emit({
    sequenceId: sequence.id,
    elapsed: reset ? 0 : Math.min(runtime.elapsed, sequence.duration),
    playing: sequence.enabled,
    recording: false,
    cameraMoving: false,
    cameraId: sequence.cameraId ?? null,
  });
  lastCameraSample = null;
  lastMovementAt = 0;
  lastRuntimeNotifyAt = 0;
  ensureRuntimeFrame();
}

export function pauseAnimationSequence() {
  manualPreview = false;
  emit({ playing: false, recording: false, cameraMoving: false });
  stopRuntimeFrame();
}

export function scrubAnimationSequence(sequence: DirectorAnimationSequence, elapsed: number) {
  activeSequence = sequence;
  manualPreview = false;
  emit({
    sequenceId: sequence.id,
    elapsed: Math.min(sequence.duration, Math.max(0, elapsed)),
    playing: false,
    recording: false,
    cameraMoving: false,
    cameraId: sequence.cameraId ?? null,
  });
  stopRuntimeFrame();
}

export function syncAnimationSequenceRuntimeDefinition(sequence: DirectorAnimationSequence) {
  if (runtime.sequenceId !== sequence.id) return false;
  activeSequence = sequence;
  const elapsed = Math.min(runtime.elapsed, sequence.duration);
  if (elapsed !== runtime.elapsed || runtime.cameraId !== (sequence.cameraId ?? null)) {
    emit({ elapsed, cameraId: sequence.cameraId ?? null });
  }
  return true;
}

export function beginAnimationSequenceRecording(
  cameraId: string,
  sequences: DirectorAnimationSequence[],
  activeSequenceId?: string | null
) {
  const sequence = sequences.find((candidate) => candidate.id === activeSequenceId)
    ?? sequences.find(
      (candidate) =>
        candidate.enabled &&
        candidate.playbackMode !== "manual" &&
        (!candidate.cameraId || candidate.cameraId === cameraId)
    );
  if (!sequence || sequence.playbackMode === "manual") return;
  if (runtime.recording && runtime.cameraId === cameraId && runtime.sequenceId === sequence.id) return;
  activeSequence = sequence;
  manualPreview = false;
  lastCameraSample = null;
  lastMovementAt = 0;
  emit({
    sequenceId: sequence.id,
    elapsed: 0,
    playing: true,
    recording: true,
    cameraMoving: false,
    cameraId,
  });
  ensureRuntimeFrame();
}

export function reportAnimationSequenceCameraMovement(cameraId: string, sample: CameraSample) {
  const sequence = activeSequence;
  if (!sequence || sequence.playbackMode !== "camera-motion" || !runtime.recording || runtime.cameraId !== cameraId) return;
  const previous = lastCameraSample;
  lastCameraSample = sample;
  if (!previous) return;
  const positionDelta = Math.hypot(...sample.position.map((value, index) => value - previous.position[index]));
  const targetDelta = Math.hypot(...sample.target.map((value, index) => value - previous.target[index]));
  const moved =
    positionDelta > POSITION_START_THRESHOLD ||
    targetDelta > TARGET_START_THRESHOLD ||
    Math.abs(sample.fov - previous.fov) > FOV_START_THRESHOLD;
  if (!moved) return;
  lastMovementAt = performance.now();
  if (!runtime.cameraMoving) emit({ cameraMoving: true });
  ensureRuntimeFrame();
}

export function endAnimationSequenceRecording(cameraId: string) {
  if (!runtime.recording || runtime.cameraId !== cameraId) return;
  emit({ playing: false, recording: false, cameraMoving: false });
  manualPreview = false;
  stopRuntimeFrame();
}

export function setAnimationSequenceRuntimeSnapshot(snapshot: AnimationSequenceRuntimeSnapshot | null | undefined) {
  if (!snapshot) return;
  activeSequence = null;
  manualPreview = false;
  stopRuntimeFrame();
  runtime = { ...snapshot };
  listeners.forEach((listener) => listener());
}

export function resetAnimationSequenceRuntime() {
  activeSequence = null;
  manualPreview = false;
  lastCameraSample = null;
  lastMovementAt = 0;
  stopRuntimeFrame();
  runtime = EMPTY_RUNTIME;
  listeners.forEach((listener) => listener());
}

export function getSequenceBindingObjectId(sequence: DirectorAnimationSequence, bindingAlias: string) {
  return sequence.bindings.find((binding) => binding.alias === bindingAlias)?.objectId ?? null;
}

export function findSequenceTrackForObject(
  sequence: DirectorAnimationSequence | null | undefined,
  objectId: string,
  type?: DirectorAnimationSequenceTrack["type"]
) {
  if (!sequence) return undefined;
  return sequence.tracks.find(
    (track) =>
      (!type || track.type === type) &&
      getSequenceBindingObjectId(sequence, track.binding) === objectId
  );
}

function getTrackTime(track: DirectorAnimationSequenceTrack, sequenceElapsed: number) {
  const start = Math.max(0, track.startTime);
  const end = Math.max(start + 0.001, track.endTime);
  if (sequenceElapsed < start) return null;
  const duration = end - start;
  const elapsed = sequenceElapsed - start;
  if (elapsed <= duration) return elapsed;
  return track.loop ? elapsed % duration : duration;
}

function getBlendWeight(track: DirectorAnimationSequenceTrack, elapsed: number) {
  const duration = Math.max(track.endTime - track.startTime, 0.001);
  const blendIn = Math.min(Math.max(track.blendIn ?? 0, 0), duration / 2);
  const blendOut = Math.min(Math.max(track.blendOut ?? 0, 0), duration / 2);
  const inWeight = blendIn > 0 ? Math.min(elapsed / blendIn, 1) : 1;
  const outWeight = blendOut > 0 ? Math.min((duration - elapsed) / blendOut, 1) : 1;
  return Math.min(Math.max(Math.min(inWeight, outWeight), 0), 1);
}

function blendControls(base: Record<string, number>, animated: Record<string, number>, weight: number) {
  const controls = { ...base };
  Object.entries(animated).forEach(([key, value]) => {
    const start = base[key] ?? 0;
    controls[key] = Number((start + (value - start) * weight).toFixed(3));
  });
  return controls;
}

function scaleTuple(value: Tuple3, weight: number): Tuple3 {
  return value.map((item) => Number((item * weight).toFixed(4))) as Tuple3;
}

export function sampleSequenceCharacter(
  sequence: DirectorAnimationSequence,
  track: DirectorCharacterAnimationTrack,
  sequenceElapsed: number,
  object: DirectorObject,
  motionClip?: CharacterMotionClip
): { rigState: CharacterRigState | undefined; rootOffset: Tuple3; rootRotation: Tuple3; elapsed: number } | null {
  const elapsed = getTrackTime(track, sequenceElapsed);
  if (elapsed === null) return null;
  const duration = Math.max(track.endTime - track.startTime, 0.001);
  const weight = getBlendWeight(track, elapsed);
  const frame = motionClip && track.motionClipId
    ? sampleCharacterMotionFrame(motionClip, elapsed, Boolean(track.loop))
    : null;
  const controls = frame?.controls ?? getActionControls(track.actionId ?? "idle", elapsed, duration);
  const rootOffset = frame?.rootOffset ?? getActionRootOffset(track.actionId ?? "idle", elapsed, duration);
  return {
    rigState: object.characterRig
      ? { ...object.characterRig, controls: blendControls(object.characterRig.controls, controls, weight) }
      : undefined,
    rootOffset: scaleTuple(rootOffset, weight),
    rootRotation: scaleTuple(frame?.rootRotation ?? [0, 0, 0], weight),
    elapsed,
  };
}

export function sampleSequenceObject(
  sequence: DirectorAnimationSequence,
  track: DirectorObjectAnimationTrack,
  sequenceElapsed: number,
  fallback: DirectorTransform
) {
  const elapsed = getTrackTime(track, sequenceElapsed);
  if (elapsed === null) return null;
  const duration = Math.max(track.endTime - track.startTime, 0.001);
  return sampleObjectAnimation(
    {
      id: track.id,
      name: track.name,
      // Sequence clips may occupy only part of a 5/10/15-second sequence.
      duration: duration as 5,
      loop: Boolean(track.loop),
      enabled: true,
      playbackMode: "normal",
      keyframes: track.keyframes,
      path: track.path,
    },
    elapsed,
    fallback
  );
}
