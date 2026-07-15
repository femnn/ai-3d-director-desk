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

  it("keeps every built-in preset action dynamic over its configured loop", () => {
    const actionIds = [
      "idle", "sit", "drink-tea", "talk", "walk", "run", "turn", "look", "wave", "bow", "think", "reach", "push", "fight", "dance", "light-dance", "phone",
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

  it("plays the Codex light dance as a continuous fifteen-second choreography", () => {
    const dancingCharacter = {
      ...character,
      characterActionTrack: {
        ...character.characterActionTrack!,
        actionId: "light-dance" as const,
        duration: 5,
        playbackMode: "normal" as const,
      },
    };
    const opening = getCharacterActionRigState(dancingCharacter, 0)?.controls ?? {};
    const overhead = getCharacterActionRigState(dancingCharacter, 4)?.controls ?? {};
    const crouch = getCharacterActionRigState(dancingCharacter, 5)?.controls ?? {};
    const kick = getCharacterActionRigState(dancingCharacter, 9.5)?.controls ?? {};
    const looped = getCharacterActionRigState(dancingCharacter, 15)?.controls ?? {};

    expect(getActionTrackDuration(dancingCharacter.characterActionTrack)).toBe(15);
    expect(overhead["leftShoulder.pitch"]).toBeGreaterThan(100);
    expect(overhead["rightShoulder.pitch"]).toBeGreaterThan(100);
    expect(crouch["body.offsetY"]).toBeLessThan(-0.3);
    expect(kick["rightHip.pitch"]).toBeGreaterThan(55);
    expect(looped).toEqual(opening);
    expect(getCharacterActionRootOffset(dancingCharacter, 1)[0]).toBeGreaterThan(0.1);
    expect(getCharacterActionRootOffset(dancingCharacter, 15)).toEqual(getCharacterActionRootOffset(dancingCharacter, 0));
  });

  it("keeps the fifteen-second dance within smooth per-frame joint changes", () => {
    const dancingCharacter = {
      ...character,
      characterActionTrack: {
        ...character.characterActionTrack!,
        actionId: "light-dance" as const,
        duration: 15,
        playbackMode: "normal" as const,
      },
    };
    let previous = getCharacterActionRigState(dancingCharacter, 0)?.controls ?? {};
    let previousRoot = getCharacterActionRootOffset(dancingCharacter, 0);
    let maximumJointDelta = 0;
    let maximumRootDelta = 0;
    for (let frame = 1; frame <= 15 * 30; frame += 1) {
      const elapsed = frame / 30;
      const current = getCharacterActionRigState(dancingCharacter, elapsed)?.controls ?? {};
      const currentRoot = getCharacterActionRootOffset(dancingCharacter, elapsed);
      Object.keys(current).forEach((key) => {
        maximumJointDelta = Math.max(maximumJointDelta, Math.abs((current[key] ?? 0) - (previous[key] ?? 0)));
      });
      maximumRootDelta = Math.max(
        maximumRootDelta,
        Math.hypot(currentRoot[0] - previousRoot[0], currentRoot[1] - previousRoot[1], currentRoot[2] - previousRoot[2])
      );
      previous = current;
      previousRoot = currentRoot;
    }

    expect(maximumJointDelta).toBeLessThan(18);
    expect(maximumRootDelta).toBeLessThan(0.04);
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
