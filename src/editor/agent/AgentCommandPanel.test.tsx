import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { AgentCommandPanel } from "./AgentCommandPanel";

const mockExecuteDirectorAgentTool = vi.fn();

vi.mock("./directorAgent", () => ({
  executeDirectorAgentTool: (...args: unknown[]) => mockExecuteDirectorAgentTool(...args),
  exportSceneScript: () => ({ reset: true }),
}));

beforeEach(() => {
  mockExecuteDirectorAgentTool.mockReset();
  mockExecuteDirectorAgentTool.mockResolvedValue({ id: "character_imported" });
});

it("imports and immediately executes a standalone character animation JSON", async () => {
  const user = userEvent.setup();
  const { container } = render(<AgentCommandPanel />);
  await user.click(screen.getByRole("button", { name: "打开AI布景面板" }));

  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const payload = {
    format: "storyai-character",
    version: 1,
    character: {
      name: "Codex轻快舞角色",
      bodyType: "female",
      action: { id: "light-dance", duration: 15, playbackMode: "normal", enabled: true },
    },
  };
  const file = new File([JSON.stringify(payload)], "codex-light-dance.character.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => JSON.stringify(payload) });

  fireEvent.change(input, { target: { files: [file] } });

  await waitFor(() => expect(mockExecuteDirectorAgentTool).toHaveBeenCalledWith("import_character", payload));
  expect(screen.getByText(/角色已导入并开始播放/)).toBeInTheDocument();
  expect(screen.getByText("导入 JSON 并执行")).toBeInTheDocument();
});

it("imports and immediately executes a scene script JSON", async () => {
  const user = userEvent.setup();
  const { container } = render(<AgentCommandPanel />);
  await user.click(screen.getByRole("button", { name: "打开AI布景面板" }));
  mockExecuteDirectorAgentTool.mockResolvedValue({ characterIds: ["character_1"], groupIds: [], propIds: [], cameraIds: [] });

  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const payload = { reset: true, characters: [{ name: "舞者", action: { id: "light-dance" } }] };
  const file = new File([JSON.stringify(payload)], "dance-stage.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => JSON.stringify(payload) });

  fireEvent.change(input, { target: { files: [file] } });

  await waitFor(() => expect(mockExecuteDirectorAgentTool).toHaveBeenCalledWith("apply_scene_script", payload));
  expect(screen.getByText(/已完成：1 个角色/)).toBeInTheDocument();
});

it("previews an animation package and confirms that it starts playing", async () => {
  const user = userEvent.setup();
  render(<AgentCommandPanel />);
  await user.click(screen.getByRole("button", { name: "打开AI布景面板" }));
  mockExecuteDirectorAgentTool.mockResolvedValue({
    name: "测试动画",
    duration: 5,
    trackCount: 1,
    warnings: [],
    autoPlaying: true,
  });
  const payload = {
    format: "storyai-animation-sequence",
    version: 1,
    sequence: {
      id: "sequence_test",
      name: "测试动画",
      duration: 5,
      playbackMode: "manual",
      loop: true,
      enabled: true,
      bindings: [],
      tracks: [],
    },
  };

  fireEvent.change(screen.getByLabelText("场景脚本JSON"), { target: { value: JSON.stringify(payload) } });
  await user.click(screen.getByRole("button", { name: "执行布景" }));
  expect(mockExecuteDirectorAgentTool).not.toHaveBeenCalled();
  expect(screen.getByText(/待确认：测试动画/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "确认应用动画" }));

  await waitFor(() => expect(mockExecuteDirectorAgentTool).toHaveBeenCalledWith("import_animation_sequence", payload));
  expect(screen.getByText(/已开始播放/)).toBeInTheDocument();
});

it("recognizes and imports an ObjectSculptSpec as an editable procedural prop", async () => {
  const user = userEvent.setup();
  const { container } = render(<AgentCommandPanel />);
  await user.click(screen.getByRole("button", { name: "打开AI布景面板" }));
  mockExecuteDirectorAgentTool.mockResolvedValue({ targetName: "电影灯", groupIds: ["group_1"], propIds: ["prop_1"], warnings: [] });

  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const payload = {
    targetName: "电影灯",
    componentTree: [{ id: "lamp_body", name: "灯体", primitive: "cylinder", parent: null }],
    materials: [{ id: "metal", baseColor: "#30343a" }],
  };
  const file = new File([JSON.stringify(payload)], "cinema-light.object-sculpt.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => JSON.stringify(payload) });

  fireEvent.change(input, { target: { files: [file] } });

  await waitFor(() => expect(mockExecuteDirectorAgentTool).toHaveBeenCalledWith("import_object_sculpt_spec", payload));
  expect(screen.getByText(/程序化道具“电影灯”已导入/)).toBeInTheDocument();
});
