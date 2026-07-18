import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createInitialDirectorState, useDirectorStore } from "../store/directorStore";
import {
  getPhoneCameraAssignments,
  getPhoneCameraUpdateTimestamp,
  getVideoCaptureFrameRate,
  queuePhoneCameraState,
  releasePhoneCamera,
} from "./phoneCameraControl";

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
