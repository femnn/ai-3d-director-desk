import { beforeEach, expect, it } from "vitest";
import { createInitialDirectorState, useDirectorStore } from "../store/directorStore";
import { handlePhonePoseState, releasePhonePose } from "./phonePoseControl";

beforeEach(() => {
  releasePhonePose("phone_pose_one");
  releasePhonePose("phone_pose_two");
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

it("accepts supported phone pose controls for a built-in mannequin", () => {
  handlePhonePoseState({ phoneClientId: "phone_pose_one", characterId: "char_default_a", key: "leftElbow.bend", value: 68 });

  expect(useDirectorStore.getState().project.objects.find((object) => object.id === "char_default_a")?.characterRig?.controls["leftElbow.bend"]).toBe(68);
});

it("does not let a second phone overwrite an occupied character pose", () => {
  handlePhonePoseState({ phoneClientId: "phone_pose_one", characterId: "char_default_a", key: "head.yaw", value: 12 });
  handlePhonePoseState({ phoneClientId: "phone_pose_two", characterId: "char_default_a", key: "head.yaw", value: 72 });

  expect(useDirectorStore.getState().project.objects.find((object) => object.id === "char_default_a")?.characterRig?.controls["head.yaw"]).toBe(12);
});
