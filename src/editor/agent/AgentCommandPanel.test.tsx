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
      action: { id: "light-dance", duration: 5, playbackMode: "normal", enabled: true },
    },
  };
  const file = new File([JSON.stringify(payload)], "codex-light-dance.character.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => JSON.stringify(payload) });

  fireEvent.change(input, { target: { files: [file] } });

  await waitFor(() => expect(mockExecuteDirectorAgentTool).toHaveBeenCalledWith("import_character", payload));
  expect(screen.getByText(/角色已导入并开始播放/)).toBeInTheDocument();
  expect(screen.getByText("导入并执行")).toBeInTheDocument();
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
  expect(screen.getByText(/普通循环动作已自动播放/)).toBeInTheDocument();
});
