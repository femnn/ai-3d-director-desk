import { describe, expect, it } from "vitest";
import { MEDIAPIPE_FACE_CHANNELS } from "./characterFaceAnimation";
import { createTextFaceClip, estimateTextFaceDuration } from "./textFaceAnimation";

describe("text face animation", () => {
  it("estimates a longer duration as spoken text grows", () => {
    expect(estimateTextFaceDuration("你好")).toBeLessThan(estimateTextFaceDuration("你好，我们现在出发去火车站。"));
    expect(estimateTextFaceDuration("Hello world")).toBeGreaterThan(0.8);
  });

  it("creates a deterministic 30fps loopable face clip", () => {
    const clip = createTextFaceClip("你好，我们现在出发吧！", "面捕演员02");
    const jawIndex = MEDIAPIPE_FACE_CHANNELS.indexOf("jawOpen");

    expect(clip.name).toContain("面捕演员02");
    expect(clip.fps).toBe(30);
    expect(clip.frames[0].time).toBe(0);
    expect(clip.frames[clip.frames.length - 1]?.time).toBeCloseTo(clip.duration, 3);
    expect(clip.frames.some((frame) => frame.values[jawIndex] > 0.2)).toBe(true);
    expect(clip.frames.every((frame) => frame.values.length === MEDIAPIPE_FACE_CHANNELS.length)).toBe(true);
    expect(clip.checksum).toMatch(/^face_/);
  });

  it("rejects text without spoken content", () => {
    expect(() => createTextFaceClip("……", "演员")).toThrow("没有可生成口型");
  });
});
