import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, RotateCcw } from "lucide-react";
import { Vector3 } from "three";
import { SceneRoot } from "../editor/canvas/SceneRoot";
import type { DirectorProject } from "../editor/schema/directorProject";
import { useDirectorStore } from "../editor/store/directorStore";
import { PhoneModeNav } from "./PhoneModeNav";
import { shouldApplyPhonePreview } from "./phonePreviewSync";

type CharacterOption = { id: string; name: string };
type ViewState = { yaw: number; pitch: number; distance: number };

function getWebSocketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/realtime`;
}

function getPhonePoseId() {
  const key = "storyai-director-phone-pose-id";
  const existing = window.localStorage.getItem(key);
  if (existing && /^[a-z0-9_-]{8,80}$/i.test(existing)) return existing;
  const id = `pose_${window.crypto?.randomUUID?.().replace(/-/g, "") ?? Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(key, id);
  return id;
}

function send(socket: WebSocket | null, payload: unknown) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

function PoseViewCamera({ target, viewRef }: { target: [number, number, number]; viewRef: React.MutableRefObject<ViewState> }) {
  const { camera } = useThree();
  useFrame(() => {
    const view = viewRef.current;
    const horizontal = Math.cos(view.pitch) * view.distance;
    const center = new Vector3(target[0], target[1] + 1.05, target[2]);
    camera.position.set(
      center.x + Math.sin(view.yaw) * horizontal,
      center.y + Math.sin(view.pitch) * view.distance,
      center.z + Math.cos(view.yaw) * horizontal
    );
    camera.lookAt(center);
    camera.updateProjectionMatrix();
  });
  return null;
}

export function PhonePoseEditor() {
  const [status, setStatus] = useState("等待导演台布景");
  const [characters, setCharacters] = useState<CharacterOption[]>([]);
  const [characterId, setCharacterId] = useState("");
  const [previewReady, setPreviewReady] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const previewVersionRef = useRef({ revision: -1, token: "" });
  const phoneIdRef = useRef(getPhonePoseId());
  const characterIdRef = useRef("");
  const viewRef = useRef<ViewState>({ yaw: 0.55, pitch: 0.12, distance: 4.6 });
  const viewPointerRef = useRef<{ x: number; y: number } | null>(null);
  const pendingControlsRef = useRef<Record<string, number>>({});
  const controlFrameRef = useRef(0);
  const [joystick, setJoystick] = useState({ x: 0, y: 0 });
  const role = useDirectorStore((state) => state.project.objects.find((object) => object.id === characterId && object.kind === "character"));
  const target = useMemo(() => (role?.transform.position ?? [0, 0, 0]) as [number, number, number], [role?.transform.position]);

  useEffect(() => {
    useDirectorStore.getState().setPoseEditMode(true);
    return () => {
      if (controlFrameRef.current) window.cancelAnimationFrame(controlFrameRef.current);
      send(socketRef.current, { type: "phone_pose", payload: { phoneClientId: phoneIdRef.current, characterId, key: "", value: 0 } });
      useDirectorStore.getState().setPoseEditMode(false);
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    let reconnectTimer = 0;
    const connect = () => {
      if (stopped) return;
      const socket = new WebSocket(getWebSocketUrl());
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        setStatus("已连接导演台，选择角色后拖动骨骼点");
        send(socket, { type: "client_hello", clientType: "phone" });
      });
      socket.addEventListener("message", (event) => {
        let message: { type?: string; state?: { mocapCharacters?: CharacterOption[]; phonePreviewProject?: DirectorProject; phonePreviewRevision?: number; phonePreviewToken?: string } };
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (message.type !== "desktop_state" || !message.state) return;
        const nextCharacters = message.state.mocapCharacters ?? [];
        setCharacters(nextCharacters);
        const nextCharacterId = nextCharacters.some((character) => character.id === characterIdRef.current)
          ? characterIdRef.current
          : nextCharacters[0]?.id ?? "";
        characterIdRef.current = nextCharacterId;
        setCharacterId(nextCharacterId);
        const revision = message.state.phonePreviewRevision ?? 0;
        const previewToken = message.state.phonePreviewToken;
        if (
          message.state.phonePreviewProject &&
          shouldApplyPhonePreview(previewVersionRef.current, previewToken, revision)
        ) {
          previewVersionRef.current = { revision, token: previewToken ?? "" };
          useDirectorStore.getState().replaceProject(message.state.phonePreviewProject);
          if (nextCharacterId) {
            useDirectorStore.getState().selectObject(nextCharacterId);
            useDirectorStore.getState().setPoseEditMode(true);
          }
          setPreviewReady(true);
        }
      });
      socket.addEventListener("close", () => {
        if (!stopped) reconnectTimer = window.setTimeout(connect, 500);
      });
    };
    connect();
    return () => {
      stopped = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, []);

  useEffect(() => {
    characterIdRef.current = characterId;
    if (!characterId) return;
    useDirectorStore.getState().selectObject(characterId);
  }, [characterId]);

  function sendPoseControls(id: string, controls: Record<string, number>) {
    Object.assign(pendingControlsRef.current, controls);
    if (controlFrameRef.current) return;
    controlFrameRef.current = window.requestAnimationFrame(() => {
      controlFrameRef.current = 0;
      const pending = pendingControlsRef.current;
      pendingControlsRef.current = {};
      if (!Object.keys(pending).length) return;
      send(socketRef.current, {
        type: "phone_pose",
        payload: { phoneClientId: phoneIdRef.current, characterId: id, controls: pending },
      });
    });
  }

  function setViewFromPointer(event: React.PointerEvent<HTMLDivElement>) {
    const previous = viewPointerRef.current;
    if (!previous) return;
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    viewPointerRef.current = { x: event.clientX, y: event.clientY };
    setJoystick({ x: Math.min(Math.max(dx / 44, -1), 1), y: Math.min(Math.max(dy / 44, -1), 1) });
    viewRef.current.yaw -= dx * 0.012;
    viewRef.current.pitch = Math.min(Math.max(viewRef.current.pitch + dy * 0.01, -0.5), 0.55);
  }

  function resetViewJoystick() {
    viewPointerRef.current = null;
    setJoystick({ x: 0, y: 0 });
  }

  return (
    <main className="phone-pose-editor">
      <header className="phone-pose-header">
        <div>
          <h1>手机骨骼编辑</h1>
          <p>{status}</p>
        </div>
        <button type="button" aria-label="重置骨骼编辑视角" onClick={() => { viewRef.current = { yaw: 0.55, pitch: 0.12, distance: 4.6 }; setJoystick({ x: 0, y: 0 }); }}>
          <RotateCcw aria-hidden="true" size={17} />
        </button>
      </header>
      <PhoneModeNav active="pose" />
      <label className="phone-pose-role">
        编辑角色
        <select value={characterId} onChange={(event) => setCharacterId(event.currentTarget.value)}>
          {characters.length ? characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>) : <option value="">等待角色</option>}
        </select>
      </label>
      <section className="phone-pose-stage" aria-label="手机三维骨骼编辑器">
        {previewReady && characterId ? (
          <Canvas camera={{ position: [2, 1.8, 4.5], fov: 35 }} gl={{ antialias: true }}>
            <color attach="background" args={["#10151d"]} />
            <ambientLight intensity={1.2} />
            <directionalLight intensity={1.3} position={[4, 6, 5]} />
            <PoseViewCamera target={target} viewRef={viewRef} />
            <SceneRoot
              focusCharacterId={characterId}
              showGround={false}
              poseHandleInteractionMode="hold"
              onPoseControlChange={sendPoseControls}
            />
          </Canvas>
        ) : (
          <div className="phone-pose-empty"><Box aria-hidden="true" size={22} />等待当前布景</div>
        )}
        <div
          className="phone-pose-view-joystick"
          aria-label="三维视角摇杆"
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); viewPointerRef.current = { x: event.clientX, y: event.clientY }; setJoystick({ x: 0, y: 0 }); }}
          onPointerMove={(event) => { if (event.buttons) setViewFromPointer(event); }}
          onPointerUp={resetViewJoystick}
          onPointerCancel={resetViewJoystick}
        >
          <span style={{ transform: `translate(${joystick.x * 24}px, ${joystick.y * 24}px)` }}>视角</span>
        </div>
      </section>
      <p className="phone-pose-note">拖动角色骨骼点摆姿；只使用右下角摇杆调整三维视角。</p>
    </main>
  );
}
