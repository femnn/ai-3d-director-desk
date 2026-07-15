import "./styles/index.css";
import { useEffect, useRef } from "react";
import { Camera, RotateCcw, X } from "lucide-react";
import { DirectorDeskShell } from "./app/layout/DirectorDeskShell";
import { DirectorDeskErrorBoundary } from "./app/DirectorDeskErrorBoundary";
import { AgentCommandPanel } from "./editor/agent/AgentCommandPanel";
import { stopNormalCharacterAnimations } from "./editor/animation/characterAnimation";
import {
  getAnimationSequenceRuntimeSnapshot,
  resetAnimationSequenceRuntime,
  scrubAnimationSequence,
  syncAnimationSequenceRuntimeDefinition,
} from "./editor/animation/animationSequence";
import { DirectorCanvas } from "./editor/canvas/DirectorCanvas";
import { initDirectorDeskHostBridge } from "./editor/io/hostBridge";
import { CameraAnimationPanel } from "./editor/phone/CameraAnimationPanel";
import { startDirectorDeskRealtime } from "./editor/realtime/directorRealtime";
import { useDirectorStore } from "./editor/store/directorStore";
import { PhoneController } from "./phone/PhoneController";
import { PhoneJoinPanel } from "./phone/PhoneJoinPanel";
import { PhonePoseEditor } from "./phone/PhonePoseEditor";

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export default function App() {
  const viewMode = useDirectorStore((state) => state.viewMode);
  const setViewMode = useDirectorStore((state) => state.setViewMode);
  const cameraMonitorCollapsed = useDirectorStore((state) => state.cameraMonitorCollapsed);
  const setCameraMonitorCollapsed = useDirectorStore((state) => state.setCameraMonitorCollapsed);
  const resetDirectorDesk = useDirectorStore((state) => state.resetDirectorDesk);
  const activeAnimationSequence = useDirectorStore((state) =>
    (state.project.animationSequences ?? []).find((sequence) => sequence.id === state.project.activeAnimationSequenceId)
  );
  const animationActivationKey = activeAnimationSequence
    ? `${activeAnimationSequence.id}:${activeAnimationSequence.playbackMode}:${activeAnimationSequence.enabled}`
    : null;
  const previousAnimationActivationKeyRef = useRef<string | null>(null);
  const isPhoneRoute = window.location.pathname === "/phone";

  useEffect(() => {
    document.body.classList.toggle("phone-route", isPhoneRoute);
    return () => document.body.classList.remove("phone-route");
  }, [isPhoneRoute]);

  useEffect(() => {
    if (isPhoneRoute) return;

    initDirectorDeskHostBridge();
    window.parent?.postMessage({ type: "storyai:director-desk-ready" }, window.location.origin);
  }, [isPhoneRoute]);

  useEffect(() => {
    if (isPhoneRoute) return;

    return startDirectorDeskRealtime();
  }, [isPhoneRoute]);

  useEffect(() => {
    if (isPhoneRoute) return;
    stopNormalCharacterAnimations();
    return stopNormalCharacterAnimations;
  }, [isPhoneRoute]);

  useEffect(() => {
    if (isPhoneRoute) return;
    if (!activeAnimationSequence) {
      previousAnimationActivationKeyRef.current = null;
      if (getAnimationSequenceRuntimeSnapshot().sequenceId) resetAnimationSequenceRuntime();
      return;
    }
    const activationChanged = previousAnimationActivationKeyRef.current !== animationActivationKey;
    previousAnimationActivationKeyRef.current = animationActivationKey;
    const runtime = getAnimationSequenceRuntimeSnapshot();
    const runtimeMatches = syncAnimationSequenceRuntimeDefinition(activeAnimationSequence);
    if (!runtimeMatches) {
      scrubAnimationSequence(activeAnimationSequence, 0);
      return;
    }
    if (!activationChanged) return;
    if (!runtime.recording) scrubAnimationSequence(activeAnimationSequence, 0);
  }, [
    activeAnimationSequence?.cameraId,
    activeAnimationSequence?.duration,
    activeAnimationSequence?.enabled,
    activeAnimationSequence?.id,
    activeAnimationSequence?.loop,
    activeAnimationSequence?.playbackMode,
    animationActivationKey,
    isPhoneRoute,
  ]);

  function handleClose() {
    window.parent?.postMessage({ type: "storyai:director-desk-close" }, window.location.origin);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isEditableShortcutTarget(event.target)) return;
      if (!event.metaKey && !event.ctrlKey) return;

      const key = event.key.toLowerCase();
      if (key === "c") {
        event.preventDefault();
        useDirectorStore.getState().copySelectedObjects();
        return;
      }

      if (key === "v") {
        event.preventDefault();
        useDirectorStore.getState().pasteClipboardObjects();
        return;
      }

      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        useDirectorStore.getState().undo();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  if (isPhoneRoute) {
    const phoneMode = new URLSearchParams(window.location.search).get("mode");
    if (phoneMode === "pose") return <PhonePoseEditor />;
    return <PhoneController />;
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="top-bar-left">
          <h1 className="top-bar-title">3D导演台</h1>
        </div>
        <div className="top-bar-center">
          <div className="mode-toggle ui-segmented" role="group" aria-label="视角切换">
            <button
              className={`mode-toggle-button ui-segmented-item ${viewMode === "director" ? "ui-segmented-item-active" : ""}`}
              aria-pressed={viewMode === "director"}
              type="button"
              onClick={() => setViewMode("director")}
            >
              导演视角
            </button>
            <button
              className={`mode-toggle-button ui-segmented-item ${viewMode === "camera" ? "ui-segmented-item-active" : ""}`}
              aria-pressed={viewMode === "camera"}
              type="button"
              onClick={() => setViewMode("camera")}
            >
              机位视角
            </button>
          </div>
        </div>
        <div className="top-bar-actions">
          {cameraMonitorCollapsed ? (
            <button
              className="top-bar-action-button"
              type="button"
              aria-label="展开机位监看"
              title="展开机位监看"
              onClick={() => setCameraMonitorCollapsed(false)}
            >
              <Camera aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
          ) : null}
          <PhoneJoinPanel />
          <CameraAnimationPanel />
          <AgentCommandPanel />
          <button
            className="top-bar-action-button"
            type="button"
            aria-label="重置导演台"
            title="重置导演台"
            onClick={() => {
              if (window.confirm("将清空当前布景、机位和轨迹，只保留一个默认角色。是否继续？")) {
                resetDirectorDesk();
              }
            }}
          >
            <RotateCcw aria-hidden="true" size={16} strokeWidth={1.8} />
          </button>
          <button
            className="top-bar-action-button"
            type="button"
            aria-label="关闭"
            title="关闭"
            onClick={handleClose}
          >
            <X aria-hidden="true" size={16} strokeWidth={1.8} />
          </button>
        </div>
      </header>
      <DirectorDeskErrorBoundary>
        <DirectorDeskShell>
          <DirectorCanvas />
        </DirectorDeskShell>
      </DirectorDeskErrorBoundary>
    </div>
  );
}
