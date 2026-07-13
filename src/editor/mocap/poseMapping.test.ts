import { describe, expect, it } from "vitest";
import { applyPoseCalibration, hasUsableFullBodyPose, mapPoseLandmarksToControls } from "./poseMapping";

const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
pose[0] = { x: 0.5, y: 0.18, z: -0.05, visibility: 1 };
// MediaPipe labels the person's anatomical left side, which appears on the
// viewer's right in a front-facing image.
pose[11] = { x: 0.62, y: 0.32, z: 0, visibility: 1 };
pose[12] = { x: 0.38, y: 0.32, z: 0, visibility: 1 };
pose[13] = { x: 0.8, y: 0.42, z: -0.08, visibility: 1 };
pose[14] = { x: 0.2, y: 0.42, z: -0.08, visibility: 1 };
pose[15] = { x: 0.9, y: 0.55, z: -0.05, visibility: 1 };
pose[16] = { x: 0.1, y: 0.55, z: -0.05, visibility: 1 };
pose[23] = { x: 0.58, y: 0.62, z: 0, visibility: 1 };
pose[24] = { x: 0.42, y: 0.62, z: 0, visibility: 1 };
pose[25] = { x: 0.58, y: 0.78, z: 0, visibility: 1 };
pose[26] = { x: 0.42, y: 0.78, z: 0, visibility: 1 };
pose[27] = { x: 0.58, y: 0.96, z: 0, visibility: 1 };
pose[28] = { x: 0.42, y: 0.96, z: 0, visibility: 1 };

describe("pose mapping", () => {
  it("maps a full-body pose into the existing mannequin controls", () => {
    expect(hasUsableFullBodyPose(pose)).toBe(true);
    const controls = mapPoseLandmarksToControls(pose);
    expect(controls).toHaveProperty("leftElbow.bend");
    expect(controls).toHaveProperty("rightKnee.bend");
    expect(controls["leftShoulder.spread"]).toBeLessThan(0);
    expect(controls["rightShoulder.spread"]).toBeGreaterThan(0);
    expect(Math.abs(controls["leftShoulder.spread"])).toBeLessThan(90);
    expect(controls["mediaPose.13.x"]).toBeCloseTo(-pose[13].x);
    expect(controls["mediaPose.13.y"]).toBeCloseTo(-pose[13].y);
  });

  it("removes the calibrated neutral offset", () => {
    expect(applyPoseCalibration({ "head.yaw": 20 }, { "head.yaw": 5 })["head.yaw"]).toBe(15);
  });
});
