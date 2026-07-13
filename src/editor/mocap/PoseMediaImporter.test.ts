import { expect, it } from "vitest";
import { smoothPoseControls } from "./PoseMediaImporter";

it("smooths video pose frames without dropping newly detected controls", () => {
  expect(
    smoothPoseControls(
      { "head.yaw": 10, "leftElbow.bend": 40 },
      { "head.yaw": 30, "leftElbow.bend": 80, "rightElbow.bend": 60 },
      0.5
    )
  ).toEqual({
    "head.yaw": 20,
    "leftElbow.bend": 60,
    "rightElbow.bend": 60,
  });
});
