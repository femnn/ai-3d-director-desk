import { expect, it } from "vitest";
import type { DirectorTransform, ObjectAnimationTrack } from "../schema/directorProject";
import { sampleObjectAnimation } from "./objectAnimation";

const BASE: DirectorTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

it("interpolates object position, rotation and scale on a fixed loop", () => {
  const track: ObjectAnimationTrack = {
    id: "move",
    name: "移动",
    duration: 5,
    loop: true,
    enabled: true,
    playbackMode: "normal",
    keyframes: [
      { time: 0, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      { time: 5, position: [10, 2, 0], rotation: [0, Math.PI, 0], scale: [2, 2, 2] },
    ],
  };

  expect(sampleObjectAnimation(track, 2.5, BASE)).toMatchObject({
    position: [5, 1, 0],
    rotation: [0, Math.PI / 2, 0],
    scale: [1.5, 1.5, 1.5],
  });
  expect(sampleObjectAnimation(track, 7.5, BASE).position).toEqual([5, 1, 0]);
});

it("moves a part on a curved closed path and follows its tangent", () => {
  const track: ObjectAnimationTrack = {
    id: "flight",
    name: "飞行",
    duration: 10,
    loop: true,
    enabled: true,
    playbackMode: "recording-sync",
    keyframes: [],
    path: {
      type: "curve",
      closed: true,
      orientToPath: true,
      points: [
        [0, 2, 0],
        [4, 3, 0],
        [4, 2, 4],
        [0, 3, 4],
      ],
    },
  };

  const sampled = sampleObjectAnimation(track, 2.5, BASE);
  expect(sampled.position[0]).toBeGreaterThan(3.5);
  expect(sampled.position[1]).toBeGreaterThan(2.5);
  expect(Number.isFinite(sampled.rotation[0])).toBe(true);
  expect(Number.isFinite(sampled.rotation[1])).toBe(true);
});
