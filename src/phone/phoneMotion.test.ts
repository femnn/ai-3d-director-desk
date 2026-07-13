import { expect, it } from "vitest";
import { getMotionCameraTarget, smoothMotionCameraAngles } from "./phoneMotion";

it("maps a clockwise phone pan to the matching desktop camera pan instead of a mirror", () => {
  const target = getMotionCameraTarget(
    { alpha: 35, beta: 0, gamma: 0 },
    { alpha: 0, beta: 0, gamma: 0 },
    { yaw: 0, pitch: 0, roll: 0 }
  );

  expect(target.yaw).toBeCloseTo((-35 * Math.PI) / 180);
});

it("filters tiny sensor variation and approaches larger physical motion gradually", () => {
  const steady = smoothMotionCameraAngles(
    { yaw: 0, pitch: 0, roll: 0 },
    { yaw: 0.003, pitch: 0.002, roll: 0.003 },
    16
  );
  expect(steady).toEqual({ yaw: 0, pitch: 0, roll: 0 });

  const moving = smoothMotionCameraAngles(
    { yaw: 0, pitch: 0, roll: 0 },
    { yaw: 1, pitch: 0.4, roll: 0.2 },
    16
  );
  expect(moving.yaw).toBeGreaterThan(0);
  expect(moving.yaw).toBeLessThan(1);
  expect(moving.pitch).toBeGreaterThan(0);
});
