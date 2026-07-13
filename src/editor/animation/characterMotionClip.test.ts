import { describe, expect, it } from "vitest";
import { getMotionClipTime, sampleCharacterMotionClip } from "./characterMotionClip";

const clip = {
  id: "mocap_1",
  characterId: "char_1",
  name: "测试动捕",
  duration: 5,
  frames: [
    { time: 0, controls: { "leftElbow.bend": 0 } },
    { time: 5, controls: { "leftElbow.bend": 80 } },
  ],
};

describe("character motion clips", () => {
  it("interpolates recorded controls for single playback", () => {
    expect(sampleCharacterMotionClip(clip, 2.5, false)["leftElbow.bend"]).toBe(40);
    expect(sampleCharacterMotionClip(clip, 8, false)["leftElbow.bend"]).toBe(80);
  });

  it("wraps only when looping is enabled", () => {
    expect(getMotionClipTime(clip, 6, true)).toBe(1);
    expect(getMotionClipTime(clip, 6, false)).toBe(5);
  });
});
