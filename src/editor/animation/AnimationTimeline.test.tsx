import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createInitialDirectorState, useDirectorStore } from "../store/directorStore";
import {
  beginAnimationSequenceRecording,
  getAnimationSequenceRuntimeSnapshot,
  resetAnimationSequenceRuntime,
  scrubAnimationSequence,
} from "./animationSequence";
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
  const sequence = useDirectorStore.getState().project.animationSequences?.[0]!;
  scrubAnimationSequence(sequence, 2.5);
  fireEvent.change(mode, { target: { value: "camera-motion" } });
  expect(useDirectorStore.getState().project.animationSequences?.[0]?.playbackMode).toBe("camera-motion");
  expect(getAnimationSequenceRuntimeSnapshot()).toMatchObject({ elapsed: 0, playing: false, recording: false });
  expect(screen.getByRole("button", { name: "等待手机录像" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "关闭动画循环" }));
  expect(useDirectorStore.getState().project.animationSequences?.[0]?.loop).toBe(false);
  expect(screen.getByRole("button", { name: "开启动画循环" })).toHaveAttribute("aria-pressed", "false");
  fireEvent.change(mode, { target: { value: "manual" } });
  expect(useDirectorStore.getState().project.animationSequences?.[0]).toMatchObject({ playbackMode: "manual", loop: true });
  expect(screen.getByRole("button", { name: "关闭动画循环" })).toHaveAttribute("aria-pressed", "true");
});

it("pauses an active recording until the user explicitly resumes it", () => {
  render(<AnimationTimeline onClose={() => undefined} />);
  fireEvent.change(screen.getByLabelText("动画播放模式"), { target: { value: "recording" } });
  const sequence = useDirectorStore.getState().project.animationSequences?.[0]!;
  const cameraId = useDirectorStore.getState().project.cameras[0]!.id;
  act(() => beginAnimationSequenceRecording(cameraId, [sequence], sequence.id));
  fireEvent.click(screen.getByRole("button", { name: "暂停动画" }));
  expect(getAnimationSequenceRuntimeSnapshot()).toMatchObject({ playing: false, recording: true });

  act(() => beginAnimationSequenceRecording(cameraId, [sequence], sequence.id, { restart: true }));
  expect(getAnimationSequenceRuntimeSnapshot()).toMatchObject({ playing: false, recording: true });
  fireEvent.click(screen.getByRole("button", { name: "继续录像动画" }));
  expect(getAnimationSequenceRuntimeSnapshot()).toMatchObject({ playing: true, recording: true });
});

it("updates duration and loop independently", () => {
  render(<AnimationTimeline onClose={() => undefined} />);
  fireEvent.change(screen.getByLabelText("动画序列时长"), { target: { value: "15" } });
  fireEvent.click(screen.getByRole("button", { name: "关闭动画循环" }));
  expect(useDirectorStore.getState().project.animationSequences?.[0]).toMatchObject({ duration: 15, loop: false });
});
