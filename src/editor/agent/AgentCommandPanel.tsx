import { useMemo, useState } from "react";
import { Bot, Download, Play, Upload, Wand2, X } from "lucide-react";
import { executeDirectorAgentTool, exportSceneScript } from "./directorAgent";

const EXAMPLE_SCRIPT = `{
  "reset": true,
  "scenePlan": {
    "intent": "男女主相对坐在茶桌前交谈",
    "environment": "安静的室内茶桌区域",
    "composition": "正对二人的中景，再补一组正反打机位",
    "roles": [
      { "name": "女主", "purpose": "对话主体", "pose": "坐姿", "relation": "面向男主" },
      { "name": "男主", "purpose": "对话主体", "pose": "坐姿", "relation": "面向女主" }
    ]
  },
  "characters": [
    { "name": "女主", "type": "female", "pose": "sit", "position": [-0.9, 0, 0], "rotationY": 1.57, "action": { "id": "drink-tea", "duration": 5, "playbackMode": "camera-driven" } },
    { "name": "男主", "type": "broad", "pose": "sit", "position": [0.9, 0, 0], "rotationY": -1.57, "action": { "id": "talk", "duration": 5, "playbackMode": "camera-driven" } }
  ],
  "props": [
    { "type": "table", "position": [0, 0.72, 0] },
    { "type": "chair", "position": [-0.9, 0.45, 0], "rotationY": 1.57 },
    { "type": "chair", "position": [0.9, 0.45, 0], "rotationY": -1.57 }
  ],
  "camera": {
    "name": "近景推镜",
    "position": [0, 1.6, 4],
    "lookAt": [0.4, 1.2, -0.3],
    "fov": 35
  }
}`;

export function AgentCommandPanel() {
  const [open, setOpen] = useState(false);
  const [script, setScript] = useState(EXAMPLE_SCRIPT);
  const [status, setStatus] = useState<string | null>(null);
  const [pendingAnimationScript, setPendingAnimationScript] = useState<string | null>(null);
  const lineCount = useMemo(() => script.split("\n").length, [script]);

  function isCharacterJson(payload: unknown) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    const candidate = payload as Record<string, unknown>;
    if (candidate.format === "storyai-character") return true;
    const sceneKeys = ["characters", "props", "groups", "proceduralObjects", "camera", "cameras", "directorView", "scene", "panorama", "scenePlan", "animationSequences"];
    return !sceneKeys.some((key) => key in candidate) && ("bodyType" in candidate || "type" in candidate) && "action" in candidate;
  }

  function isObjectSculptJson(payload: unknown) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    const candidate = payload as Record<string, unknown>;
    return typeof candidate.targetName === "string" && Array.isArray(candidate.componentTree) && Array.isArray(candidate.materials);
  }

  function isAnimationSequenceJson(payload: unknown) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    const candidate = payload as Record<string, unknown>;
    return candidate.format === "storyai-animation-sequence" || (
      Array.isArray(candidate.bindings) && Array.isArray(candidate.tracks) && typeof candidate.duration === "number"
    );
  }

  function isCharacterAnimationJson(payload: unknown) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    const candidate = payload as Record<string, unknown>;
    return candidate.format === "storyai-character-animation" &&
      Array.isArray(candidate.characters) && Array.isArray(candidate.animationSequences);
  }

  async function executePayload(payload: unknown, options: { importedFile?: boolean } = {}) {
    if (isCharacterAnimationJson(payload)) {
      const result = await executeDirectorAgentTool("import_character_animation", payload) as {
        characterIds?: string[];
        animationSequenceReviews?: Array<{ autoPlaying?: boolean }>;
      };
      setStatus(
        `角色动画已追加到当前布景：新增 ${result.characterIds?.length ?? 0} 个角色、${result.animationSequenceReviews?.length ?? 0} 段动画${result.animationSequenceReviews?.some((review) => review.autoPlaying) ? "，已循环播放" : "，等待录制触发"}。`
      );
      return;
    }
    if (isAnimationSequenceJson(payload)) {
      const result = await executeDirectorAgentTool("import_animation_sequence", payload) as {
        name?: string;
        duration?: number;
        trackCount?: number;
        warnings?: string[];
        autoPlaying?: boolean;
      };
      setStatus(`动画“${result.name ?? "未命名"}”已导入：${result.duration ?? 0}秒、${result.trackCount ?? 0}条轨道${result.autoPlaying ? "，已开始播放" : "，等待录制触发"}${result.warnings?.length ? `；${result.warnings.length}项警告` : ""}。`);
      return;
    }
    if (isObjectSculptJson(payload)) {
      const result = await executeDirectorAgentTool("import_object_sculpt_spec", payload) as {
        targetName?: string;
        groupIds?: string[];
        propIds?: string[];
        warnings?: string[];
      };
      setStatus(
        `程序化道具“${result.targetName ?? "未命名"}”已导入：${result.groupIds?.length ?? 0} 个组合、${result.propIds?.length ?? 0} 个可编辑部件${result.warnings?.length ? `；${result.warnings.length} 项使用安全近似` : ""}。`
      );
      return;
    }
    if (isCharacterJson(payload)) {
      const result = await executeDirectorAgentTool("import_character", payload) as { id?: string };
      setStatus(`角色已导入并开始播放${result.id ? `（${result.id}）` : ""}`);
      return;
    }
    const scenePayload = options.importedFile && payload && typeof payload === "object" && !Array.isArray(payload)
      ? { ...(payload as Record<string, unknown>), reset: true }
      : payload;
    const result = await executeDirectorAgentTool("apply_scene_script", scenePayload);
    const summary = result && typeof result === "object" ? result as {
      characterIds?: string[];
      groupIds?: string[];
      propIds?: string[];
      cameraIds?: string[];
      scenePlan?: unknown;
      proceduralWarnings?: string[];
      animationSequenceReviews?: Array<{ autoPlaying?: boolean }>;
    } : {};
    const sequenceMessage = summary.animationSequenceReviews?.length
      ? `；已载入 ${summary.animationSequenceReviews.length} 个统一动画序列${summary.animationSequenceReviews.some((review) => review.autoPlaying) ? "并开始播放" : "，等待录制触发"}`
      : "";
    setStatus(
      `${options.importedFile ? "已替换为导入布景" : "已完成"}：${summary.characterIds?.length ?? 0} 个角色、${summary.groupIds?.length ?? 0} 个组合、${summary.propIds?.length ?? 0} 个部件、${summary.cameraIds?.length ?? 0} 个机位${summary.proceduralWarnings?.length ? `；${summary.proceduralWarnings.length} 项采用安全近似` : ""}${sequenceMessage}。`
    );
  }

  async function applyScript() {
    try {
      const payload = JSON.parse(script) as unknown;
      if (isAnimationSequenceJson(payload) && pendingAnimationScript !== script) {
        const wrapper = payload as { sequence?: { name?: string; duration?: number; tracks?: unknown[] } };
        const candidate = wrapper.sequence ?? payload as { name?: string; duration?: number; tracks?: unknown[] };
        setPendingAnimationScript(script);
        setStatus(`待确认：${candidate.name ?? "未命名动画"}，${candidate.duration ?? 0}秒，${candidate.tracks?.length ?? 0}条轨道。再次点击即应用，并可一步撤销。`);
        return;
      }
      await executePayload(payload);
      setPendingAnimationScript(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "执行失败");
    }
  }

  function loadCurrentSceneScript() {
    setScript(JSON.stringify(exportSceneScript(), null, 2));
    setStatus("已生成当前布景命令");
  }

  function downloadSceneScript() {
    const blob = new Blob([script], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "storyai-director-scene-script.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <button
        className="top-bar-action-button"
        type="button"
        aria-label="打开AI布景面板"
        title="AI布景"
        onClick={() => setOpen(true)}
      >
        <Bot aria-hidden="true" size={16} strokeWidth={1.8} />
      </button>
      {open ? (
        <div className="agent-panel" role="dialog" aria-label="AI布景命令">
          <div className="agent-panel-header">
            <div>
              <h2>AI布景命令</h2>
              <p>支持布景、独立角色、ObjectSculptSpec 程序化道具和 AI 动画序列 JSON；创建后会自动截图供 agent 复查。</p>
            </div>
            <button type="button" aria-label="关闭AI布景面板" onClick={() => setOpen(false)}>
              <X aria-hidden="true" size={16} />
            </button>
          </div>
          <textarea
            className="agent-panel-textarea"
            aria-label="场景脚本JSON"
            rows={Math.min(Math.max(lineCount, 10), 22)}
            spellCheck={false}
            value={script}
            onChange={(event) => {
              setScript(event.target.value);
              setPendingAnimationScript(null);
            }}
          />
          <div className="agent-panel-footer">
            <div className="agent-panel-actions">
              <button type="button" onClick={loadCurrentSceneScript}>
                <Wand2 aria-hidden="true" size={15} />
                生成当前布景命令
              </button>
              <button type="button" onClick={downloadSceneScript}>
                <Download aria-hidden="true" size={15} />
                下载命令
              </button>
              <label>
                <Upload aria-hidden="true" size={15} />
                导入 JSON 并执行
                <input
                  accept="application/json,.json"
                  type="file"
                  onChange={async (event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (!file) return;
                    try {
                      const text = await file.text();
                      setScript(text);
                      const payload = JSON.parse(text) as unknown;
                      if (isAnimationSequenceJson(payload)) {
                        setPendingAnimationScript(text);
                        const wrapper = payload as { sequence?: { name?: string; duration?: number; tracks?: unknown[] } };
                        const candidate = wrapper.sequence ?? payload as { name?: string; duration?: number; tracks?: unknown[] };
                        setStatus(`待确认：${candidate.name ?? "未命名动画"}，${candidate.duration ?? 0}秒，${candidate.tracks?.length ?? 0}条轨道。`);
                      } else {
                        await executePayload(payload, { importedFile: true });
                      }
                    } catch (error) {
                      setStatus(error instanceof Error ? error.message : "导入执行失败");
                    }
                  }}
                />
              </label>
            </div>
            <button className="agent-panel-run" type="button" onClick={() => void applyScript()}>
              <Play aria-hidden="true" size={15} />
              {pendingAnimationScript === script ? "确认应用动画" : "执行布景"}
            </button>
            {status ? <p>{status}</p> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
