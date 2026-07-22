import { describe, expect, it } from "vitest";
import { MEDIAPIPE_FACE_CHANNELS } from "./characterFaceAnimation";
import { createTextFaceClip, estimateTextFaceDuration, fitTextFaceInput, getTextFaceTiming } from "./textFaceAnimation";

describe("text face animation", () => {
  it("uses empty, 5, 10 and 15 second duration buckets", () => {
    expect(estimateTextFaceDuration("")).toBe(0);
    expect(estimateTextFaceDuration("你好")).toBe(5);
    expect(estimateTextFaceDuration("你好".repeat(12))).toBe(10);
    expect(estimateTextFaceDuration("你好".repeat(22))).toBe(15);
    expect(getTextFaceTiming("你好".repeat(35)).exceedsLimit).toBe(true);
  });

  it("creates a deterministic 30fps loopable face clip", async () => {
    const clip = await createTextFaceClip("你好，我们现在出发吧！", "面捕演员02");
    const jawIndex = MEDIAPIPE_FACE_CHANNELS.indexOf("jawOpen");

    expect(clip.name).toContain("面捕演员02");
    expect(clip.fps).toBe(30);
    expect(clip.frames[0].time).toBe(0);
    expect(clip.duration).toBe(5);
    expect(clip.frames[clip.frames.length - 1]?.time).toBe(clip.duration);
    expect(clip.frames.some((frame) => frame.values[jawIndex] > 0.2)).toBe(true);
    expect(clip.frames.every((frame) => frame.values.length === MEDIAPIPE_FACE_CHANNELS.length)).toBe(true);
    expect(clip.checksum).toMatch(/^face_/);
  });

  it("maps Chinese pinyin initials and finals to distinct mouth shapes", async () => {
    const closed = await createTextFaceClip("妈妈", "演员");
    const open = await createTextFaceClip("啊啊", "演员");
    const closeIndex = MEDIAPIPE_FACE_CHANNELS.indexOf("mouthClose");
    const jawIndex = MEDIAPIPE_FACE_CHANNELS.indexOf("jawOpen");

    expect(Math.max(...closed.frames.map((frame) => frame.values[closeIndex]))).toBeGreaterThan(0.35);
    expect(Math.max(...open.frames.map((frame) => frame.values[jawIndex]))).toBeGreaterThan(0.4);
  });

  it("rejects text without spoken content", async () => {
    await expect(createTextFaceClip("……", "演员")).rejects.toThrow("没有可生成口型");
  });

  it("keeps pasted text and truncates only the part beyond 15 seconds", () => {
    const source = "这是一段通过剪贴板粘贴进来的角色对白。".repeat(8);
    const fitted = fitTextFaceInput(source);

    expect(fitted.truncated).toBe(true);
    expect(fitted.text.length).toBeGreaterThan(0);
    expect(source.startsWith(fitted.text)).toBe(true);
    expect(getTextFaceTiming(fitted.text).exceedsLimit).toBe(false);
  });
});
