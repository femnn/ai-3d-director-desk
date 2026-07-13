import { beforeEach, expect, it } from "vitest";
import { createInitialDirectorState, useDirectorStore } from "../store/directorStore";
import { getPhoneMocapAssignments, handlePhoneMocapState, releasePhoneMocap } from "./phoneMocapControl";

const controls = { "head.yaw": 12, "leftElbow.bend": 36, "rightKnee.bend": 22 };

beforeEach(() => {
  releasePhoneMocap("phone_mocap_one");
  releasePhoneMocap("phone_mocap_two");
  useDirectorStore.setState({
    ...useDirectorStore.getState(),
    ...createInitialDirectorState(),
    clipboard: [],
    clipboardPasteCount: 0,
    undoStack: [],
    undoBatchDepth: 0,
    undoBatchSnapshot: null,
    undoBatchHasTrackedChanges: false,
  });
});

it("turns a phone motion capture stream into a character motion clip", () => {
  const characterId = "char_default_a";
  handlePhoneMocapState({ phoneClientId: "phone_mocap_one", characterId, phase: "start", duration: 5 });
  handlePhoneMocapState({ phoneClientId: "phone_mocap_one", characterId, phase: "frame", time: 0, controls });
  handlePhoneMocapState({ phoneClientId: "phone_mocap_one", characterId, phase: "frame", time: 0.2, controls: { ...controls, "head.yaw": 20 } });
  handlePhoneMocapState({ phoneClientId: "phone_mocap_one", characterId, phase: "finish" });

  const role = useDirectorStore.getState().project.objects.find((object) => object.id === characterId);
  const clip = useDirectorStore.getState().project.characterMotionClips?.[0];

  expect(clip?.name).toContain("手机动捕");
  expect(clip?.frames).toHaveLength(2);
  expect(role?.characterActionTrack?.source).toBe("mocap");
  expect(getPhoneMocapAssignments()).toEqual({});
});

it("keeps a character claimed by its first phone while recording", () => {
  const characterId = "char_default_a";
  handlePhoneMocapState({ phoneClientId: "phone_mocap_one", characterId, phase: "start", duration: 5 });
  handlePhoneMocapState({ phoneClientId: "phone_mocap_two", characterId, phase: "start", duration: 5 });

  expect(getPhoneMocapAssignments()).toEqual({ phone_mocap_one: characterId });
});
