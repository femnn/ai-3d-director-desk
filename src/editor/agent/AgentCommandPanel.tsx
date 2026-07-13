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
  const lineCount = useMemo(() => script.split("\n").length, [script]);

  async function applyScript() {
    try {
      const payload = JSON.parse(script) as unknown;
      const result = await executeDirectorAgentTool("apply_scene_script", payload);
      const summary = result && typeof result === "object" ? result as { characterIds?: string[]; propIds?: string[]; cameraIds?: string[]; scenePlan?: unknown } : {};
      setStatus(
        `已完成：${summary.characterIds?.length ?? 0} 个角色、${summary.propIds?.length ?? 0} 个道具、${summary.cameraIds?.length ?? 0} 个机位。已自动截取当前画面供 agent 复查。`
      );
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
              <p>粘贴含场景计划的 JSON，创建后会自动截取当前画面供 agent 复查修正。</p>
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
            onChange={(event) => setScript(event.target.value)}
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
                导入命令
                <input
                  accept="application/json"
                  type="file"
                  onChange={async (event) => {
                    const file = event.currentTarget.files?.[0];
                    if (!file) return;
                    setScript(await file.text());
                    setStatus(`已导入 ${file.name}`);
                  }}
                />
              </label>
            </div>
            <button className="agent-panel-run" type="button" onClick={() => void applyScript()}>
              <Play aria-hidden="true" size={15} />
              执行布景
            </button>
            {status ? <p>{status}</p> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
