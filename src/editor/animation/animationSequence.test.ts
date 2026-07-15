import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectorAnimationSequence, DirectorObject } from "../schema/directorProject";
import {
  beginAnimationSequenceRecording,
  endAnimationSequenceRecording,
  getAnimationSequenceRuntimeSnapshot,
  playAnimationSequence,
  pauseAnimationSequence,
  reportAnimationSequenceCameraMovement,
  resetAnimationSequenceRuntime,
  resumeAnimationSequenceRecording,
  sampleSequenceCharacter,
  sampleSequenceObject,
} from "./animationSequence";

const sequence: DirectorAnimationSequence = {
  id: "sequence_test",
  name: "测试序列",
  duration: 5,
  playbackMode: "manual",
  loop: false,
  enabled: true,
  cameraId: "cam_1",
  bindings: [{ alias: "target", objectId: "object_1", objectName: "目标" }],
  tracks: [],
};

const object: DirectorObject = {
  id: "object_1",
  name: "目标",
  kind: "character",
  visible: true,
  locked: false,
  transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  characterRig: { rigType: "ue4-mannequin", posePresetId: "stand", controls: {} },
};

describe("unified animation sequence clock", () => {
  let callbacks: Array<FrameRequestCallback>;
  let now: number;

  beforeEach(() => {
    callbacks = [];
    now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    resetAnimationSequenceRuntime();
  });

  afterEach(() => {
    resetAnimationSequenceRuntime();
    vi.restoreAllMocks();
  });

  function step(milliseconds: number) {
    now = milliseconds;
    const callback = callbacks.shift();
    callback?.(milliseconds);
  }

  it("previews manual sequences without a recording clock", () => {
    playAnimationSequence(sequence);
    step(16);
    step(50);
    expect(getAnimationSequenceRuntimeSnapshot()).toMatchObject({ sequenceId: sequence.id, playing: true });
    expect(getAnimationSequenceRuntimeSnapshot().elapsed).toBeGreaterThan(0);
  });

  it("resets recording sequences and advances them from the same shared clock", () => {
    const recordingSequence = { ...sequence, playbackMode: "recording" as const };
    beginAnimationSequenceRecording("cam_1", [recordingSequence], recordingSequence.id);
    step(16);
    step(50);
    expect(getAnimationSequenceRuntimeSnapshot()).toMatchObject({ recording: true, cameraId: "cam_1" });
    expect(getAnimationSequenceRuntimeSnapshot().elapsed).toBeGreaterThan(0);
    endAnimationSequenceRecording("cam_1");
    expect(getAnimationSequenceRuntimeSnapshot().playing).toBe(false);
  });

  it("uses an eligible recording sequence when the selected sequence is manual and restarts at capture start", () => {
    const manualSequence = { ...sequence, id: "manual_selected", playbackMode: "manual" as const };
    const recordingSequence = { ...sequence, id: "recording_fallback", playbackMode: "recording" as const };
    beginAnimationSequenceRecording("cam_1", [manualSequence, recordingSequence], manualSequence.id);
    step(16);
    step(50);
    expect(getAnimationSequenceRuntimeSnapshot()).toMatchObject({
      sequenceId: recordingSequence.id,
      recording: true,
      playing: true,
    });
    expect(getAnimationSequenceRuntimeSnapshot().elapsed).toBeGreaterThan(0);

    beginAnimationSequenceRecording("cam_1", [manualSequence, recordingSequence], manualSequence.id, { restart: true });
    expect(getAnimationSequenceRuntimeSnapshot()).toMatchObject({
      sequenceId: recordingSequence.id,
      elapsed: 0,
      recording: true,
      playing: true,
    });
  });

  it("keeps a user-paused recording sequence stopped when more phone frames arrive", () => {
    const recordingSequence = { ...sequence, playbackMode: "recording" as const };
    beginAnimationSequenceRecording("cam_1", [recordingSequence], recordingSequence.id);
    step(16);
    step(50);
    pauseAnimationSequence();
    const pausedAt = getAnimationSequenceRuntimeSnapshot().elapsed;
    expect(getAnimationSequenceRuntimeSnapshot()).toMatchObject({ playing: false, recording: true });

    beginAnimationSequenceRecording("cam_1", [recordingSequence], recordingSequence.id, { restart: true });
    step(80);
    expect(getAnimationSequenceRuntimeSnapshot()).toMatchObject({ playing: false, recording: true, elapsed: pausedAt });

    resumeAnimationSequenceRecording();
    step(114);
    expect(getAnimationSequenceRuntimeSnapshot()).toMatchObject({ playing: true, recording: true });
    expect(getAnimationSequenceRuntimeSnapshot().elapsed).toBeGreaterThan(pausedAt);
  });

  it("holds camera-motion sequences until movement crosses the jitter threshold", () => {
    const drivenSequence = { ...sequence, playbackMode: "camera-motion" as const };
    beginAnimationSequenceRecording("cam_1", [drivenSequence], drivenSequence.id);
    reportAnimationSequenceCameraMovement("cam_1", { position: [0, 0, 0], target: [0, 0, 1], fov: 35, time: 0 });
    reportAnimationSequenceCameraMovement("cam_1", { position: [0.001, 0, 0], target: [0, 0, 1.001], fov: 35.01, time: 16 });
    step(16);
    step(50);
    expect(getAnimationSequenceRuntimeSnapshot().elapsed).toBe(0);

    now = 60;
    reportAnimationSequenceCameraMovement("cam_1", { position: [0.02, 0, 0], target: [0, 0, 1.03], fov: 35.2, time: 60 });
    step(76);
    step(110);
    expect(getAnimationSequenceRuntimeSnapshot().cameraMoving).toBe(true);
    expect(getAnimationSequenceRuntimeSnapshot().elapsed).toBeGreaterThan(0);
  });
});

describe("sequence track sampling", () => {
  it("samples character controls and external root motion", () => {
    const track = {
      id: "character_track",
      name: "角色轨道",
      type: "character" as const,
      binding: "target",
      startTime: 0,
      endTime: 5,
      motionClipId: "clip_1",
    };
    const result = sampleSequenceCharacter(
      sequence,
      track,
      2.5,
      object,
      {
        id: "clip_1",
        characterId: object.id,
        name: "动作",
        duration: 5,
        frames: [
          { time: 0, controls: { "body.yaw": 0 }, rootOffset: [0, 0, 0] },
          { time: 5, controls: { "body.yaw": 40 }, rootOffset: [2, 0, 0] },
        ],
      }
    );
    expect(result?.rigState?.controls["body.yaw"]).toBe(20);
    expect(result?.rootOffset).toEqual([1, 0, 0]);
  });

  it("samples object keyframes in local track time", () => {
    const result = sampleSequenceObject(
      sequence,
      {
        id: "object_track",
        name: "跳跃",
        type: "object",
        binding: "target",
        startTime: 1,
        endTime: 5,
        keyframes: [
          { time: 0, position: [0, 0, 0] },
          { time: 4, position: [4, 2, 0] },
        ],
      },
      3,
      object.transform
    );
    expect(result?.position).toEqual([2, 1, 0]);
  });
});
