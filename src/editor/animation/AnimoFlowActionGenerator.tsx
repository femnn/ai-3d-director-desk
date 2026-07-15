import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { DirectorObject } from "../schema/directorProject";
import { useDirectorStore } from "../store/directorStore";
import { getDefaultCharacterActionDuration, playNormalCharacterAnimations } from "./characterAnimation";
import type { CharacterActionId } from "../schema/directorProject";

type AnimoFlowJob = {
  job_id?: string;
  status?: string;
  download_url?: string;
  error?: string | null;
};

function getDownloadUrl(downloadUrl: string | undefined, jobId: string) {
  if (downloadUrl?.startsWith("/v1/")) return `/api/animoflow/${downloadUrl.slice(4)}`;
  if (downloadUrl?.startsWith("/")) return downloadUrl;
  if (downloadUrl?.startsWith("http")) return downloadUrl;
  return `/api/animoflow/files/${jobId}`;
}

function getPreviewActionId(prompt: string): CharacterActionId {
  const text = prompt.toLowerCase();
  if (/跑|run|jog/.test(text)) return "run";
  if (/走|walk|前进/.test(text)) return "walk";
  if (/轻快舞|活力舞|codex.*舞|light.?dance/.test(text)) return "light-dance";
  if (/跳舞|舞|dance/.test(text)) return "dance";
  if (/格斗|打|fight|punch/.test(text)) return "fight";
  if (/喝|茶|drink|cup/.test(text)) return "drink-tea";
  if (/招手|挥手|wave/.test(text)) return "wave";
  if (/鞠躬|bow/.test(text)) return "bow";
  if (/坐|sit/.test(text)) return "sit";
  if (/转身|turn/.test(text)) return "turn";
  if (/说|交谈|talk/.test(text)) return "talk";
  if (/伸|reach/.test(text)) return "reach";
  return "idle";
}

async function readJson(response: Response) {
  const payload = (await response.json()) as AnimoFlowJob & { error?: string };
  if (!response.ok) throw new Error(payload.error || "AnimoFlow 动作服务请求失败");
  return payload;
}

async function persistGeneratedAnimation(downloadUrl: string, fileName: string) {
  const source = await fetch(downloadUrl);
  if (!source.ok) throw new Error("无法读取生成的动作文件");
  const contentType = source.headers.get("content-type") ?? "application/octet-stream";
  const bytes = await source.arrayBuffer();
  const signature = new TextDecoder("ascii").decode(bytes.slice(0, 4));
  const hasSupportedExtension = /\.(fbx|glb|gltf)$/i.test(fileName);
  const extension = signature === "glTF" || /gltf-binary|model\/gltf/i.test(contentType) ? "glb" : "fbx";
  const normalizedFileName = hasSupportedExtension ? fileName : `${fileName || "animation"}.${extension}`;
  const response = await fetch(`/api/generated-animations?fileName=${encodeURIComponent(normalizedFileName)}`, {
    method: "POST",
    headers: { "content-type": contentType },
    body: bytes,
  });
  const payload = (await response.json()) as { url?: string; fileName?: string; error?: string };
  if (!response.ok || !payload.url) throw new Error(payload.error || "无法保存生成的动作文件");
  return { url: payload.url, fileName: payload.fileName || normalizedFileName };
}

export function AnimoFlowActionGenerator({ character }: { character: DirectorObject }) {
  const [prompt, setPrompt] = useState("一个人自然地端起茶杯喝茶，再放回桌上");
  const [status, setStatus] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  async function generate() {
    const text = prompt.trim();
    if (text.length < 3 || generating) return;

    setGenerating(true);
    setStatus("正在提交 AnimoFlow 动作生成");
    try {
      const previewActionId = getPreviewActionId(text);
      const requestedDuration = getDefaultCharacterActionDuration(previewActionId);
      const created = await readJson(
        await fetch("/api/animoflow/jobs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            input: { type: "text", prompt: text },
            model: "mdm",
            character: "Y_bot",
            duration: requestedDuration,
          }),
        })
      );
      if (!created.job_id) throw new Error("AnimoFlow 没有返回任务编号");

      let job = created;
      for (let attempt = 0; attempt < 180; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        job = await readJson(await fetch(`/api/animoflow/jobs/${encodeURIComponent(created.job_id)}`));
        if (job.status === "done") break;
        if (job.status === "failed" || job.status === "cancelled") {
          throw new Error(job.error || "AnimoFlow 动作生成失败");
        }
        setStatus(`正在生成动作 ${Math.min(attempt + 1, 99)}%`);
      }
      if (job.status !== "done") throw new Error("AnimoFlow 动作生成超时");

      const store = useDirectorStore.getState();
      const original = store.project.objects.find((item) => item.id === character.id) ?? character;
      const downloadUrl = getDownloadUrl(job.download_url, created.job_id);
      const fileName = downloadUrl.split("?")[0].split("/").pop() || `${created.job_id}.glb`;
      setStatus("正在保存生成的动作到本地导演台");
      const savedAnimation = await persistGeneratedAnimation(downloadUrl, fileName);
      store.clearCharacterAsset(original.id);
      const attached = useDirectorStore.getState().attachImportedAssetToCharacter(original.id, {
        kind: "character",
        name: `${original.name}-AI动作`,
        fileName: savedAnimation.fileName,
        url: savedAnimation.url,
        animated: true,
      });
      if (!attached) throw new Error("原角色已不存在，无法附加生成动作");
      const updatedStore = useDirectorStore.getState();
      updatedStore.setCharacterActionTrack(original.id, {
        actionId: previewActionId,
        duration: requestedDuration,
        loop: true,
        playbackMode: "normal",
        cameraId: null,
        enabled: true,
      });
      playNormalCharacterAnimations(
        useDirectorStore
          .getState()
          .project.objects.filter(
            (item) => item.kind === "character" && item.characterActionTrack?.enabled && item.characterActionTrack.playbackMode === "normal"
          )
          .map((item) => item.id)
      );
      setStatus(`动作已生成并附加到 ${original.name}：${savedAnimation.fileName}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "AnimoFlow 动作生成失败");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section className="animoflow-generator" aria-label="AnimoFlow 动作生成">
      <div className="animoflow-generator-heading">
        <Sparkles aria-hidden="true" size={15} />
        <span>AnimoFlow 生成动作</span>
      </div>
      <textarea
        aria-label="AnimoFlow 动作描述"
        value={prompt}
        rows={3}
        onChange={(event) => setPrompt(event.currentTarget.value)}
      />
      <button type="button" disabled={generating || prompt.trim().length < 3} onClick={() => void generate()}>
        <Sparkles aria-hidden="true" size={15} />
        {generating ? "正在生成" : "生成并附加到当前角色"}
      </button>
      {status ? <p>{status}</p> : null}
    </section>
  );
}
