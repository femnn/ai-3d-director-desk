import { CatmullRomCurve3, Vector3 } from "three";
import type {
  DirectorObject,
  DirectorTransform,
  ObjectAnimationKeyframe,
  ObjectAnimationTrack,
} from "../schema/directorProject";

type Tuple3 = [number, number, number];
type CameraSample = { position: Tuple3; target: Tuple3; fov: number; time: number };
type CameraDriver = {
  active: boolean;
  lastMovementAt: number;
  lastSample: CameraSample | null;
  objectIds: string[];
};

const CAMERA_MOVEMENT_HOLD_MS = 200;
const elapsedByObjectId = new Map<string, number>();
const normalStartedAtByObjectId = new Map<string, number>();
const recordingObjectIdsByCameraId = new Map<string, string[]>();
const cameraDrivers = new Map<string, CameraDriver>();
let runtimeFrame = 0;
let runtimeLastAt = 0;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpTuple(a: Tuple3, b: Tuple3, t: number): Tuple3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function sampleKeyframes(
  keyframes: ObjectAnimationKeyframe[],
  elapsed: number,
  duration: number,
  fallback: DirectorTransform
): DirectorTransform {
  const ordered = [...keyframes].sort((a, b) => a.time - b.time);
  if (!ordered.length) return fallback;
  const previous = [...ordered].reverse().find((frame) => frame.time <= elapsed) ?? ordered[0];
  const next = ordered.find((frame) => frame.time >= elapsed) ?? ordered[ordered.length - 1];
  const span = Math.max(next.time - previous.time, 0.0001);
  const t = previous === next ? 0 : clamp((elapsed - previous.time) / span, 0, 1);
  const previousPosition = previous.position ?? fallback.position;
  const nextPosition = next.position ?? previousPosition;
  const previousRotation = previous.rotation ?? fallback.rotation;
  const nextRotation = next.rotation ?? previousRotation;
  const previousScale = previous.scale ?? fallback.scale;
  const nextScale = next.scale ?? previousScale;
  return {
    position: lerpTuple(previousPosition, nextPosition, t),
    rotation: lerpTuple(previousRotation, nextRotation, t),
    scale: lerpTuple(previousScale, nextScale, t),
  };
}

function samplePath(track: ObjectAnimationTrack, elapsed: number) {
  const path = track.path;
  if (!path || path.points.length < 2) return null;
  const progress = clamp(elapsed / Math.max(track.duration, 0.001), 0, 1);
  if (path.type === "linear") {
    const segmentCount = path.closed ? path.points.length : path.points.length - 1;
    const scaled = progress * segmentCount;
    const segment = Math.min(Math.floor(scaled), segmentCount - 1);
    const localProgress = scaled - segment;
    const current = path.points[segment];
    const next = path.points[(segment + 1) % path.points.length];
    return {
      position: lerpTuple(current, next, localProgress),
      tangent: new Vector3(...next).sub(new Vector3(...current)).normalize(),
    };
  }
  const curve = new CatmullRomCurve3(path.points.map((point) => new Vector3(...point)), path.closed, "centripetal");
  const point = curve.getPoint(progress);
  return {
    position: [point.x, point.y, point.z] as Tuple3,
    tangent: curve.getTangent(progress),
  };
}

export function sampleObjectAnimation(
  track: ObjectAnimationTrack | undefined,
  elapsed: number,
  fallback: DirectorTransform
): DirectorTransform {
  if (!track?.enabled) return fallback;
  const duration = Math.max(track.duration, 0.001);
  const localElapsed = track.loop ? ((elapsed % duration) + duration) % duration : clamp(elapsed, 0, duration);
  const sampled = sampleKeyframes(track.keyframes, localElapsed, duration, fallback);
  const pathSample = samplePath(track, localElapsed);
  if (!pathSample) return sampled;
  const rotation = [...sampled.rotation] as Tuple3;
  if (track.path?.orientToPath && pathSample.tangent.lengthSq() > 0) {
    rotation[0] = Math.atan2(pathSample.tangent.y, Math.hypot(pathSample.tangent.x, pathSample.tangent.z));
    rotation[1] = Math.atan2(pathSample.tangent.x, pathSample.tangent.z);
  }
  return { ...sampled, position: pathSample.position, rotation };
}

export function getObjectAnimationElapsed(object: DirectorObject, now = performance.now()) {
  const track = object.objectAnimationTrack;
  if (!track?.enabled) return 0;
  if (track.playbackMode === "normal") {
    const startedAt = normalStartedAtByObjectId.get(object.id) ?? now;
    normalStartedAtByObjectId.set(object.id, startedAt);
    return Math.max(0, (now - startedAt) / 1000);
  }
  return elapsedByObjectId.get(object.id) ?? 0;
}

export function getObjectAnimationElapsedSnapshot(objects: DirectorObject[]) {
  return Object.fromEntries(
    objects
      .filter((object) => object.objectAnimationTrack?.enabled)
      .map((object) => [object.id, Number(getObjectAnimationElapsed(object).toFixed(4))])
  );
}

export function setObjectAnimationElapsedSnapshot(snapshot: Record<string, number> | null | undefined) {
  const now = performance.now();
  Object.entries(snapshot ?? {}).forEach(([id, elapsed]) => {
    if (!Number.isFinite(elapsed)) return;
    elapsedByObjectId.set(id, elapsed);
    normalStartedAtByObjectId.set(id, now - elapsed * 1000);
  });
}

function ensureRuntimeFrame() {
  if (runtimeFrame || typeof window === "undefined") return;
  runtimeLastAt = performance.now();
  runtimeFrame = window.requestAnimationFrame(tickRuntime);
}

function tickRuntime(now: number) {
  runtimeFrame = 0;
  const delta = clamp((now - runtimeLastAt) / 1000, 0, 0.05);
  runtimeLastAt = now;
  const activeIds = new Set<string>();
  recordingObjectIdsByCameraId.forEach((ids) => ids.forEach((id) => activeIds.add(id)));
  cameraDrivers.forEach((driver) => {
    if (driver.active && now - driver.lastMovementAt > CAMERA_MOVEMENT_HOLD_MS) driver.active = false;
    if (driver.active) driver.objectIds.forEach((id) => activeIds.add(id));
  });
  activeIds.forEach((id) => elapsedByObjectId.set(id, (elapsedByObjectId.get(id) ?? 0) + delta));
  if (recordingObjectIdsByCameraId.size || cameraDrivers.size) runtimeFrame = window.requestAnimationFrame(tickRuntime);
}

export function beginObjectAnimationsForCamera(cameraId: string, objects: DirectorObject[]) {
  if (!cameraId) return;
  if (!recordingObjectIdsByCameraId.has(cameraId)) {
    const recordingIds = objects
      .filter(
        (object) =>
          object.objectAnimationTrack?.enabled &&
          object.objectAnimationTrack.playbackMode === "recording-sync" &&
          (!object.objectAnimationTrack.cameraId || object.objectAnimationTrack.cameraId === cameraId)
      )
      .map((object) => object.id);
    recordingIds.forEach((id) => elapsedByObjectId.set(id, 0));
    recordingObjectIdsByCameraId.set(cameraId, recordingIds);
  }
  if (!cameraDrivers.has(cameraId)) {
    const objectIds = objects
      .filter(
        (object) =>
          object.objectAnimationTrack?.enabled &&
          object.objectAnimationTrack.playbackMode === "camera-driven" &&
          (!object.objectAnimationTrack.cameraId || object.objectAnimationTrack.cameraId === cameraId)
      )
      .map((object) => object.id);
    objectIds.forEach((id) => elapsedByObjectId.set(id, 0));
    cameraDrivers.set(cameraId, { active: false, lastMovementAt: 0, lastSample: null, objectIds });
  }
  ensureRuntimeFrame();
}

export function reportCameraDrivenObjectMovement(cameraId: string, sample: CameraSample) {
  const driver = cameraDrivers.get(cameraId);
  if (!driver) return;
  const previous = driver.lastSample;
  driver.lastSample = sample;
  if (!previous) return;
  const positionDelta = Math.hypot(...sample.position.map((value, index) => value - previous.position[index]));
  const targetDelta = Math.hypot(...sample.target.map((value, index) => value - previous.target[index]));
  if (positionDelta <= 0.002 && targetDelta <= 0.003 && Math.abs(sample.fov - previous.fov) <= 0.04) return;
  driver.active = true;
  driver.lastMovementAt = performance.now();
  ensureRuntimeFrame();
}

export function endObjectAnimationsForCamera(cameraId: string) {
  recordingObjectIdsByCameraId.delete(cameraId);
  cameraDrivers.delete(cameraId);
  if (!recordingObjectIdsByCameraId.size && !cameraDrivers.size && runtimeFrame) {
    window.cancelAnimationFrame(runtimeFrame);
    runtimeFrame = 0;
  }
}

export function resetObjectAnimationRuntime() {
  elapsedByObjectId.clear();
  normalStartedAtByObjectId.clear();
  recordingObjectIdsByCameraId.clear();
  cameraDrivers.clear();
  if (runtimeFrame && typeof window !== "undefined") window.cancelAnimationFrame(runtimeFrame);
  runtimeFrame = 0;
}
