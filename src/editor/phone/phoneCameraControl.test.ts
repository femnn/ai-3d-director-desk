import { beforeEach, expect, it, vi } from "vitest";
import { createInitialDirectorState, useDirectorStore } from "../store/directorStore";
import {
  getPhoneCameraAssignments,
  getPhoneCameraUpdateTimestamp,
  queuePhoneCameraState,
  releasePhoneCamera,
} from "./phoneCameraControl";

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
