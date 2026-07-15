import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createInitialDirectorState, useDirectorStore } from "../store/directorStore";
import { resetAnimationSequenceRuntime } from "./animationSequence";
import { AnimationTimeline } from "./AnimationTimeline";

beforeEach(() => {
  useDirectorStore.setState({
    ...useDirectorStore.getState(),
    ...createInitialDirectorState(),
  });
  const role = useDirectorStore.getState().project.objects.find((object) => object.kind === "character")!;
  useDirectorStore.getState().addAnimationSequence({
    id: "sequence_ui",
    name: "界面测试动画",
    duration: 5,
    playbackMode: "manual",
    loop: true,
    enabled: true,
    cameraId: null,
    bindings: [{ alias: "role", objectId: role.id, objectName: role.name }],
    tracks: [{ id: "role_track", name: "角色轨道", type: "character", binding: "role", startTime: 0, endTime: 5, actionId: "dance" }],
  });
});

afterEach(() => resetAnimationSequenceRuntime());

it("shows the unified tracks and exposes only the three user-facing playback modes", () => {
  render(<AnimationTimeline onClose={() => undefined} />);
  expect(screen.getByRole("region", { name: "统一动画时间轴" })).toBeInTheDocument();
  expect(screen.getByText("界面测试动画")).toBeInTheDocument();
  expect(screen.getByText("角色轨道")).toBeInTheDocument();
  const mode = screen.getByLabelText("动画播放模式");
  expect(Array.from(mode.querySelectorAll("option")).map((option) => option.textContent)).toEqual([
    "手动播放",
    "录制时播放",
    "随镜头运动",
  ]);
  fireEvent.change(mode, { target: { value: "camera-motion" } });
  expect(useDirectorStore.getState().project.animationSequences?.[0]?.playbackMode).toBe("camera-motion");
  fireEvent.click(screen.getByLabelText("循环播放"));
  expect(useDirectorStore.getState().project.animationSequences?.[0]?.loop).toBe(false);
  fireEvent.change(mode, { target: { value: "manual" } });
  expect(useDirectorStore.getState().project.animationSequences?.[0]).toMatchObject({ playbackMode: "manual", loop: true });
});

it("updates duration and loop independently", () => {
  render(<AnimationTimeline onClose={() => undefined} />);
  fireEvent.change(screen.getByLabelText("动画序列时长"), { target: { value: "15" } });
  fireEvent.click(screen.getByLabelText("循环播放"));
  expect(useDirectorStore.getState().project.animationSequences?.[0]).toMatchObject({ duration: 15, loop: false });
});
