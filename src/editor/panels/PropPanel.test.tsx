import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach } from "vitest";
import { createInitialDirectorState, useDirectorStore } from "../store/directorStore";
import { PropPanel } from "./PropPanel";

beforeEach(() => {
  const base = createInitialDirectorState();
  useDirectorStore.setState({
    ...useDirectorStore.getState(),
    ...base,
    selectedObjectId: "prop_model_1",
    project: {
      ...base.project,
      assets: [
        {
          id: "asset_model_1",
          kind: "prop",
          sourceType: "model",
          fileName: "ATM_low.fbx",
          url: "blob:atm",
        },
      ],
      objects: [
        ...base.project.objects,
        {
          id: "prop_model_1",
          name: "自动取款机",
          kind: "prop",
          visible: true,
          locked: false,
          color: "#d7e7ff",
          assetRefId: "asset_model_1",
          transform: {
            position: [0, 0, 0] as [number, number, number],
            rotation: [0, 0, 0] as [number, number, number],
            scale: [1, 1, 1] as [number, number, number],
          },
        },
      ],
    },
  });
});

it("renders the prop inspector fields for imported models", () => {
  render(<PropPanel />);

  expect(screen.getByText("模型")).toBeInTheDocument();
  expect(screen.getByLabelText("模型名称")).toBeInTheDocument();
  expect(screen.getByLabelText("模型位置 X")).toBeInTheDocument();
  expect(screen.getByLabelText("模型旋转 X")).toBeInTheDocument();
  expect(screen.getByLabelText("模型缩放 X")).toBeInTheDocument();
  expect(screen.getByLabelText("模型统一缩放")).toBeInTheDocument();
  expect(screen.getByLabelText("模型颜色 HEX")).toBeInTheDocument();
});

it("exposes safe transformer parameters for a registered procedural model", () => {
  useDirectorStore.getState().setObjectProceduralFactory("prop_model_1", {
    id: "crimson-transformer",
    parameters: { morph: 0.25, autoTransform: true, transformDuration: 10 },
  });

  render(<PropPanel />);

  expect(screen.getByText("程序化模型")).toBeInTheDocument();
  expect(screen.getByLabelText("程序化模型变形方式")).toHaveTextContent("自动往返变形");
  expect(screen.getByLabelText("程序化模型变形进度数值")).toHaveValue(0.25);
  expect(screen.getByLabelText("程序化模型自动变形时长")).toHaveTextContent("10秒");
});

it("updates the selected prop name, uniform scale, and color", async () => {
  const user = userEvent.setup();
  render(<PropPanel />);

  await user.clear(screen.getByLabelText("模型名称"));
  await user.type(screen.getByLabelText("模型名称"), "近景 ATM");
  await user.clear(screen.getByLabelText("模型统一缩放"));
  await user.type(screen.getByLabelText("模型统一缩放"), "1.4");
  await user.clear(screen.getByLabelText("模型颜色 HEX"));
  await user.type(screen.getByLabelText("模型颜色 HEX"), "#aaccee");

  const prop = useDirectorStore.getState().project.objects.find((item) => item.id === "prop_model_1");
  expect(prop?.name).toBe("近景 ATM");
  expect(prop?.transform.scale).toEqual([1.4, 1.4, 1.4]);
  expect(prop?.color).toBe("#aaccee");
});

it("records manual keyframes and numbered path points from the current prop transform", async () => {
  const user = userEvent.setup();
  useDirectorStore.getState().setObjectAnimationTrack("prop_model_1", {
    id: "object_animation_prop_model_1",
    name: "ATM 动画",
    duration: 5,
    loop: true,
    enabled: false,
    playbackMode: "normal",
    keyframes: [],
    path: { type: "linear", closed: false, orientToPath: false, points: [[0, 0, 0]] },
  });
  render(<PropPanel />);

  expect(screen.getByLabelText("路径点 1 X")).toHaveValue(0);
  await user.click(screen.getByRole("button", { name: "记录当前位置 / 旋转 / 缩放" }));
  await user.click(screen.getByRole("button", { name: "把当前物体位置添加为路径点" }));

  const track = useDirectorStore.getState().project.objects.find((item) => item.id === "prop_model_1")?.objectAnimationTrack;
  expect(track?.keyframes).toHaveLength(1);
  expect(track?.keyframes[0]?.time).toBe(0);
  expect(track?.path?.points).toHaveLength(2);
  expect(screen.getByText("路径点 2")).toBeInTheDocument();
});
