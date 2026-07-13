import type { CharacterMotionClip } from "../schema/directorProject";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function getMotionClipTime(clip: CharacterMotionClip, elapsed: number, loop: boolean) {
  const duration = Math.max(clip.duration, 0.001);
  if (loop) return ((elapsed % duration) + duration) % duration;
  return clamp(elapsed, 0, duration);
}

export function sampleCharacterMotionClip(clip: CharacterMotionClip, elapsed: number, loop: boolean) {
  const frames = [...clip.frames].sort((left, right) => left.time - right.time);
  if (!frames.length) return {};

  const time = getMotionClipTime(clip, elapsed, loop);
  const nextIndex = frames.findIndex((frame) => frame.time >= time);
  if (nextIndex <= 0) return { ...frames[0].controls };
  if (nextIndex === -1) return { ...frames[frames.length - 1].controls };

  const previous = frames[nextIndex - 1];
  const next = frames[nextIndex];
  const span = Math.max(next.time - previous.time, 0.001);
  const t = clamp((time - previous.time) / span, 0, 1);
  const keys = new Set([...Object.keys(previous.controls), ...Object.keys(next.controls)]);
  const controls: Record<string, number> = {};
  keys.forEach((key) => {
    const start = previous.controls[key] ?? next.controls[key] ?? 0;
    const end = next.controls[key] ?? start;
    controls[key] = Number((start + (end - start) * t).toFixed(3));
  });
  return controls;
}
