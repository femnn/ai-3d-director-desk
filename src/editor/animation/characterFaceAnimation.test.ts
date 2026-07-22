import { describe, expect, it } from "vitest";
import type { CharacterFaceClip } from "../schema/directorProject";
import { mapFaceInfluences, sampleCharacterFaceClip, sampleCharacterFaceFrame } from "./characterFaceAnimation";

const clip: CharacterFaceClip = {
  id: "face_1",
  characterId: "character_1",
  name: "测试表情",
  duration: 5,
  fps: 30,
  channels: ["jawOpen", "mouthSmileLeft", "mouthSmileRight"],
  checksum: "test",
  frames: [
    { time: 0, values: [0, 0, 0], headRotation: [0, 0, 0, 1] },
    { time: 5, values: [1, 0.8, 0.6], headRotation: [0, 0.4, 0, 0.9165] },
  ],
};

describe("character face animation", () => {
  it("interpolates values and a normalized head rotation", () => {
    const frame = sampleCharacterFaceFrame(clip, 2.5, false);
    expect(frame.values).toEqual([0.5, 0.4, 0.3]);
    expect(Math.hypot(...frame.headRotation)).toBeCloseTo(1, 4);
  });

  it("loops independently using the face clip duration", () => {
    expect(sampleCharacterFaceFrame(clip, 6, true).time).toBe(1);
  });

  it("maps the same raw clip to FaceCap and GNM targets", () => {
    const facecap = sampleCharacterFaceClip(clip, "facecap52", 2.5, false);
    const gnm = sampleCharacterFaceClip(clip, "gnm21", 2.5, false);
    expect(facecap.influences.jawOpen).toBe(0.5);
    expect(gnm.influences.jaw_open).toBe(0.5);
    expect(gnm.influences.happy).toBeGreaterThan(0.3);
    expect(mapFaceInfluences("facecap52", { eyeBlinkLeft: 1 }).eyeBlink_L).toBe(1);
  });

  it("keeps GNM speech shapes on the mouth instead of scaling the whole head", () => {
    const speech = mapFaceInfluences("gnm21", {
      mouthClose: 0.8,
      mouthPressLeft: 0.5,
      mouthPressRight: 0.5,
      mouthStretchLeft: 0.7,
      mouthStretchRight: 0.7,
    });

    expect(speech.compress_face).toBe(0);
    expect(speech.stretch_face).toBe(0);
    expect(speech.lips_roll_in).toBeGreaterThan(0.45);
    expect(speech.smile_wide).toBeGreaterThan(0.35);
  });
});
