import { useRef, useState, type ChangeEvent } from "react";
import { Download, Upload } from "lucide-react";
import { exportCharacterPackage, importCharacterPackage } from "../agent/directorAgent";

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "-").trim() || "角色";
}

export function CharacterJsonControls({ characterId, characterName }: { characterId: string; characterName: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");

  function exportCharacter() {
    const payload = exportCharacterPackage(characterId);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFileName(characterName)}.character.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("角色 JSON 已导出");
  }

  async function importCharacter(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text()) as unknown;
      importCharacterPackage(payload);
      setStatus("角色已导入");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "角色 JSON 导入失败");
    }
  }

  return (
    <div className="character-json-controls">
      <input
        ref={inputRef}
        className="hidden-file-input"
        type="file"
        accept="application/json,.json"
        onChange={(event) => void importCharacter(event)}
      />
      <div className="inspector-action-row" role="group" aria-label="角色 JSON 导入导出">
        <button type="button" onClick={exportCharacter}>
          <Download aria-hidden="true" size={14} />
          导出角色
        </button>
        <button type="button" onClick={() => inputRef.current?.click()}>
          <Upload aria-hidden="true" size={14} />
          导入角色
        </button>
      </div>
      {status ? <p className="character-json-status" role="status">{status}</p> : null}
    </div>
  );
}
