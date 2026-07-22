import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createInitialDirectorState, useDirectorStore } from "../store/directorStore";
import {
  createVideoRecorder,
  getPhoneCameraAssignments,
  getPhoneCameraUpdateTimestamp,
  getVideoCaptureFrameRate,
  queuePhoneCameraState,
  releasePhoneCamera,
  resetPhoneCameraControlForTests,
} from "./phoneCameraControl";

it("prefers one continuous VP8 WebM recorder source", () => {
  const starts: Array<{ mimeType?: string; bits?: number }> = [];
  class MockMediaRecorder {
    static isTypeSupported(mimeType: string) {
      return mimeType === "video/webm;codecs=vp8" || mimeType.startsWith("video/mp4");
    }
    constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
      starts.push({ mimeType: options?.mimeType, bits: options?.videoBitsPerSecond });
    }
  }
  vi.stubGlobal("MediaRecorder", MockMediaRecorder);

  createVideoRecorder({} as MediaStream);

  expect(starts).toEqual([{ mimeType: "video/webm;codecs=vp8", bits: 6_000_000 }]);
});

it("keeps five-second capture at 60fps and reduces encoder pressure for longer takes", () => {
  expect(getVideoCaptureFrameRate(5)).toBe(60);
  expect(getVideoCaptureFrameRate(10)).toBe(30);
  expect(getVideoCaptureFrameRate(15)).toBe(30);
  expect(getVideoCaptureFrameRate(undefined)).toBe(60);
});

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(0));
    return 1;
  });
  useDirectorStore.setState({
    ...useDirectorStore.getState(),
    ...createInitialDirectorState(),
  });
  releasePhoneCamera("phone_test_one");
  releasePhoneCamera("phone_test_two");
  resetPhoneCameraControlForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps phone controllers on separate cameras and preserves the director monitor selection", async () => {
  const initialCameraId = useDirectorStore.getState().project.cameras[0]!.id;

  queuePhoneCameraState({
    phoneClientId: "phone_test_one",
    cameraId: initialCameraId,
    position: [1, 1.6, 4],
    yaw: 0,
    pitch: 0,
    fov: 35,
    updatedAt: 1,
  });
  queuePhoneCameraState({
    phoneClientId: "phone_test_two",
    cameraId: initialCameraId,
    position: [-1, 1.6, 4],
    yaw: 0,
    pitch: 0,
    fov: 35,
    updatedAt: 1,
  });

  await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

  const project = useDirectorStore.getState().project;
  const assignments = getPhoneCameraAssignments();

  expect(assignments.phone_test_one).toBe(initialCameraId);
  expect(assignments.phone_test_two).toBeDefined();
  expect(assignments.phone_test_two).not.toBe(initialCameraId);
  expect(project.cameras).toHaveLength(2);
  expect(project.activeCameraId).toBe(initialCameraId);
  expect(getPhoneCameraUpdateTimestamp(assignments.phone_test_one!)).toBe(1);
  expect(getPhoneCameraUpdateTimestamp(assignments.phone_test_two!)).toBe(1);
});

it("applies the latest phone state when requestAnimationFrame is throttled", () => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", () => 99);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  const cameraId = useDirectorStore.getState().project.cameras[0]!.id;

  queuePhoneCameraState({
    phoneClientId: "phone_test_one",
    cameraId,
    position: [2, 2, 6],
    yaw: 0.2,
    pitch: -0.1,
    fov: 51,
    updatedAt: 10,
  });
  vi.advanceTimersByTime(45);

  expect(useDirectorStore.getState().project.cameras.find((camera) => camera.id === cameraId)?.fov).toBe(51);
  expect(getPhoneCameraUpdateTimestamp(cameraId)).toBe(10);
});

it("creates only one trajectory for duplicate states in the same recording session", async () => {
  const cameraId = useDirectorStore.getState().project.cameras[0]!.id;
  const baseState = {
    phoneClientId: "phone_test_one",
    cameraId,
    yaw: 0,
    pitch: 0,
    fov: 35,
    recording: true,
    recordingDuration: 5,
    recordingSessionId: "session_one",
    recordingStartedAt: 1_000,
  };

  for (let index = 0; index < 8; index += 1) {
    queuePhoneCameraState({
      ...baseState,
      position: [index * 0.1, 1.6, 5],
      updatedAt: 1_000 + index * 20,
    });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
  }
  queuePhoneCameraState({ ...baseState, position: [0.8, 1.6, 5], recording: false, updatedAt: 1_200 });
  await new Promise<void>((resolve) => queueMicrotask(resolve));

  expect(useDirectorStore.getState().project.cameraAnimations).toHaveLength(1);

  queuePhoneCameraState({ ...baseState, position: [0.9, 1.6, 5], updatedAt: 1_220 });
  queuePhoneCameraState({ ...baseState, position: [1, 1.6, 5], recording: false, updatedAt: 1_240 });
  await new Promise<void>((resolve) => queueMicrotask(resolve));

  expect(useDirectorStore.getState().project.cameraAnimations).toHaveLength(1);
});

it("ignores a reconnecting phone's empty stop state during an active session", async () => {
  const cameraId = useDirectorStore.getState().project.cameras[0]!.id;
  queuePhoneCameraState({
    phoneClientId: "phone_test_one",
    cameraId,
    position: [0, 1.6, 5],
    recording: true,
    recordingSessionId: "session_reconnect",
    recordingStartedAt: 2_000,
    updatedAt: 2_000,
  });
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  queuePhoneCameraState({
    phoneClientId: "phone_test_one",
    cameraId,
    position: [0.2, 1.6, 5],
    recording: false,
    updatedAt: 2_020,
  });
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  queuePhoneCameraState({
    phoneClientId: "phone_test_one",
    cameraId,
    position: [0.4, 1.6, 5],
    recording: true,
    recordingSessionId: "session_reconnect",
    recordingStartedAt: 2_000,
    updatedAt: 2_040,
  });
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  queuePhoneCameraState({
    phoneClientId: "phone_test_one",
    cameraId,
    position: [0.6, 1.6, 5],
    recording: false,
    recordingSessionId: "session_reconnect",
    recordingStartedAt: 2_000,
    updatedAt: 2_060,
  });
  await new Promise<void>((resolve) => queueMicrotask(resolve));

  expect(useDirectorStore.getState().project.cameraAnimations).toHaveLength(1);
});
