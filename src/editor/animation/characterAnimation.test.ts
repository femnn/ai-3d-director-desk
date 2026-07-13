import { describe, expect, it } from "vitest";
import {
  MIN_CHARACTER_ACTION_DURATION,
  beginCameraDrivenCharacterAnimations,
  endCameraDrivenCharacterAnimations,
  getActionTrackDuration,
  getCharacterActionRootOffset,
  getCharacterActionElapsed,
  getCharacterActionRigState,
  getCharacterAnimationElapsedSnapshot,
  reportCameraDrivenCharacterMovement,
  setCharacterAnimationElapsedSnapshot,
} from "./characterAnimation";
import type { DirectorObject } from "../schema/directorProject";

const character: DirectorObject = {
  id: "char_1",
  name: "角色01",
  kind: "character",
  visible: true,
  locked: false,
  transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  characterRig: { rigType: "mannequin", posePresetId: "stand", controls: {} },
  characterActionTrack: {
    actionId: "drink-tea",
    duration: 2,
    loop: true,
    playbackMode: "camera-driven",
    cameraId: null,
    enabled: true,
  },
};

describe("character action timeline", () => {
  it("clamps every action to at least five seconds", () => {
    expect(getActionTrackDuration(character.characterActionTrack)).toBe(MIN_CHARACTER_ACTION_DURATION);
  });

  it("evaluates a drink action into a temporary rig pose", () => {
    const rig = getCharacterActionRigState(character, 1.25);
    expect(rig?.controls["rightElbow.bend"]).toBeGreaterThan(70);
    expect(character.characterRig?.controls).toEqual({});
  });

  it("keeps every built-in preset action dynamic over its five-second loop", () => {
    const actionIds = [
      "idle", "sit", "drink-tea", "talk", "walk", "run", "turn", "look", "wave", "bow", "think", "reach", "push", "fight", "dance", "phone",
    ] as const;

    actionIds.forEach((actionId) => {
      const animatedCharacter = {
        ...character,
        characterActionTrack: { ...character.characterActionTrack!, actionId, playbackMode: "normal" as const },
      };
      expect(getCharacterActionRigState(animatedCharacter, 0)?.controls).not.toEqual(
        getCharacterActionRigState(animatedCharacter, 1.25)?.controls
      );
    });
  });

  it("advances camera-driven actions only after the camera has moved", () => {
    setCharacterAnimationElapsedSnapshot({ [character.id]: 0 });
    beginCameraDrivenCharacterAnimations("cam_1", [character.id]);
    reportCameraDrivenCharacterMovement("cam_1", {
      position: [0, 1.6, 4],
      target: [0, 1.2, 0],
      fov: 35,
      time: 1000,
    });
    reportCameraDrivenCharacterMovement("cam_1", {
      position: [0, 1.6, 3.8],
      target: [0, 1.2, -0.2],
      fov: 35,
      time: 1600,
    });

    expect(getCharacterActionElapsed(character.id)).toBeCloseTo(1 / 30, 4);
    const advanced = getCharacterActionElapsed(character.id);
    reportCameraDrivenCharacterMovement("cam_1", {
      position: [0, 1.6, 3.8],
      target: [0, 1.2, -0.2],
      fov: 35,
      time: 2200,
    });
    expect(getCharacterActionElapsed(character.id)).toBe(advanced);
    endCameraDrivenCharacterAnimations("cam_1");
  });

  it("moves a walking character forward once per action segment without endless drift", () => {
    const walkingCharacter = {
      ...character,
      characterActionTrack: { ...character.characterActionTrack!, actionId: "walk" as const },
    };
    expect(getCharacterActionRootOffset(walkingCharacter, 5)[2]).toBeGreaterThan(2);
    expect(getCharacterActionRootOffset(walkingCharacter, 20)[2]).toBe(getCharacterActionRootOffset(walkingCharacter, 5)[2]);
  });

  it("can replace the animation clock from the desktop preview snapshot", () => {
    setCharacterAnimationElapsedSnapshot({ [character.id]: 2.5 });
    expect(getCharacterAnimationElapsedSnapshot()[character.id]).toBe(2.5);
  });
});
