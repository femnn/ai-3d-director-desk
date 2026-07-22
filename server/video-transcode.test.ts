import { expect, it } from "vitest";
import { getVideoFilter } from "./video-transcode.mjs";

it("keeps long recordings smooth and pads only to the requested complete duration", () => {
  expect(getVideoFilter(30, 10)).toBe(
    "setpts=PTS-STARTPTS,fps=30,minterpolate=fps=60:mi_mode=blend,tpad=stop_mode=clone:stop_duration=10"
  );
  expect(getVideoFilter(30, 15)).toContain("minterpolate=fps=60:mi_mode=blend");
  expect(getVideoFilter(60, 5)).toBe("setpts=PTS-STARTPTS,fps=60,tpad=stop_mode=clone:stop_duration=5");
});
