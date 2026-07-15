import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createInitialDirectorState, useDirectorStore } from "../store/directorStore";
import {
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

it("shows unified tracks with one automatic looping playback path", () => {
  render(<AnimationTimeline onClose={() => undefined} />);
  expect(screen.getByRole("region", { name: "统一动画时间轴" })).toBeInTheDocument();
  expect(screen.getByText("界面测试动画")).toBeInTheDocument();
  expect(screen.getByText("角色轨道")).toBeInTheDocument();
  expect(screen.queryByLabelText("动画播放模式")).not.toBeInTheDocument();
  expect(screen.getByLabelText("动画自动循环")).toHaveTextContent("自动循环");
  const sequence = useDirectorStore.getState().project.animationSequences?.[0]!;
  expect(sequence).toMatchObject({ playbackMode: "manual", loop: true, enabled: true });
  fireEvent.click(screen.getByRole("button", { name: "播放动画" }));
  expect(getAnimationSequenceRuntimeSnapshot()).toMatchObject({ playing: true, recording: false });
  fireEvent.click(screen.getByRole("button", { name: "暂停动画" }));
  expect(getAnimationSequenceRuntimeSnapshot()).toMatchObject({ playing: false, recording: false });
});

it("starts a newly selected sequence immediately", () => {
  useDirectorStore.getState().addAnimationSequence({
    ...useDirectorStore.getState().project.animationSequences![0]!,
    id: "sequence_two",
    name: "第二段动画",
  });
  render(<AnimationTimeline onClose={() => undefined} />);
  const first = useDirectorStore.getState().project.animationSequences![0]!;

  fireEvent.change(screen.getByLabelText("当前动画序列"), { target: { value: first.id } });
  expect(getAnimationSequenceRuntimeSnapshot()).toMatchObject({ sequenceId: first.id, playing: true, recording: false });
});

it("updates duration while keeping automatic looping enabled", () => {
  render(<AnimationTimeline onClose={() => undefined} />);
  fireEvent.change(screen.getByLabelText("动画序列时长"), { target: { value: "15" } });
  expect(useDirectorStore.getState().project.animationSequences?.[0]).toMatchObject({ duration: 15, loop: true });
});

it("normalizes disabled sequences before playback", () => {
  const sequence = useDirectorStore.getState().project.animationSequences?.[0]!;
  useDirectorStore.getState().updateAnimationSequence(sequence.id, { enabled: false });
  expect(useDirectorStore.getState().project.animationSequences?.[0]?.enabled).toBe(true);
  render(<AnimationTimeline onClose={() => undefined} />);

  fireEvent.click(screen.getByRole("button", { name: "播放动画" }));

  expect(useDirectorStore.getState().project.animationSequences?.[0]?.enabled).toBe(true);
  expect(getAnimationSequenceRuntimeSnapshot()).toMatchObject({ sequenceId: sequence.id, playing: true });
});
