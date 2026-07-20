import { expect, it } from "vitest";
import type { CharacterFaceClip } from "../schema/directorProject";
import { exportFaceAnimationPackage, parseFaceAnimationFile } from "./faceClipIo";

it("round trips a compact StoryAI face animation package", () => {
  const clip: CharacterFaceClip = {
    id: "face_1",
    characterId: "role_1",
    name: "笑脸",
    duration: 5,
    fps: 30,
    channels: ["jawOpen"],
    frames: [
      { time: 0, values: [0], headRotation: [0, 0, 0, 1] },
      { time: 5, values: [1], headRotation: [0, 0.2, 0, 0.98] },
    ],
    checksum: "face_test",
  };
  const parsed = parseFaceAnimationFile(exportFaceAnimationPackage(clip));
  expect(parsed.name).toBe("笑脸");
  expect(parsed.frames).toHaveLength(2);
  expect(parsed.frames[1].values[0]).toBe(1);
});

it("imports GNM Studio motion data and removes the neutral expression", () => {
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const parsed = parseFaceAnimationFile({
    format: "gnm-studio-motion",
    version: 2,
    fps: 30,
    neutral: {
      blendshapes: [{ name: "jawOpen", score: 0.1 }],
      matrix,
    },
    frames: [
      { timestamp: 1000, blendshapes: { jawOpen: 0.1 }, matrix },
      { timestamp: 2000, blendshapes: { jawOpen: 0.8 }, matrix },
    ],
  });
  const jawIndex = parsed.channels.indexOf("jawOpen");
  expect(parsed.duration).toBe(1);
  expect(parsed.frames[0].values[jawIndex]).toBe(0);
  expect(parsed.frames[1].values[jawIndex]).toBeCloseTo(0.7);
});
