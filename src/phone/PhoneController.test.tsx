import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getCharacterActionElapsed, setCharacterAnimationElapsedSnapshot } from "../editor/animation/characterAnimation";
import { getCameraViewSnapshotFromShot } from "../editor/schema/cameraGeometry";
import { createDefaultDirectorProject, useDirectorStore } from "../editor/store/directorStore";
import { PhoneController } from "./PhoneController";

const previewProbe = vi.hoisted(() => ({ viewRef: null as { current: unknown } | null }));

vi.mock("./PhoneCameraPreview", () => ({
  PhoneCameraPreview: ({ onCameraChange, viewRef }: {
    onCameraChange: (cameraId: string) => void;
    viewRef: { current: unknown };
  }) => {
    previewProbe.viewRef = viewRef;
    return (
      <div aria-label="我的机位画面">
        <select aria-label="切换控制机位" onChange={(event) => onCameraChange(event.currentTarget.value)} />
      </div>
    );
  },
}));

class MockWebSocket {
  static readonly OPEN = 1;
  static sent: string[] = [];
  static instances: MockWebSocket[] = [];
  readonly readyState = MockWebSocket.OPEN;
  private listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  constructor() {
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    if (type === "open") queueMicrotask(() => listener(new MessageEvent("open")));
  }

  receive(payload: unknown) {
    const event = new MessageEvent("message", { data: JSON.stringify(payload) });
    this.listeners.get("message")?.forEach((listener) => listener(event));
  }

  close() {}

  send(payload: string) {
    MockWebSocket.sent.push(payload);
  }
}

beforeEach(() => {
  MockWebSocket.sent = [];
  MockWebSocket.instances = [];
  previewProbe.viewRef = null;
  setCharacterAnimationElapsedSnapshot(null);
  useDirectorStore.getState().replaceProject(createDefaultDirectorProject());
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      json: async () => ({
        desktopUrl: "http://127.0.0.1:5173/",
        phoneUrl: null,
        websocketUrl: "ws://127.0.0.1:5173/realtime",
        lanUrls: [],
      }),
    })
  );
});

it("keeps the phone preview on the desktop-authoritative camera while local input is pending", async () => {
  window.history.replaceState({}, "", "/phone?mode=standard");
  const project = createDefaultDirectorProject();
  const camera = project.cameras[0];
  const firstView = { fov: 42, position: [1, 1.8, 5] as [number, number, number], target: [-1, 1.2, 0] as [number, number, number] };
  render(<PhoneController />);

  await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
  MockWebSocket.instances[0].receive({
    type: "desktop_state",
    state: {
      activeCameraId: camera.id,
      cameras: [{ id: camera.id, name: camera.name, ...firstView }],
      phonePreviewRevision: 1,
      phonePreviewToken: "desktop-camera:1",
      phonePreviewProject: project,
    },
  });

  await waitFor(() => expect(previewProbe.viewRef?.current).toEqual(firstView));
  fireEvent.click(screen.getByRole("button", { name: "重置摄影机" }));
  expect(previewProbe.viewRef?.current).toEqual(firstView);

  const confirmedView = { fov: 35, position: [0, 1.6, 5] as [number, number, number], target: [0, 1.6, 1] as [number, number, number] };
  MockWebSocket.instances[0].receive({
    type: "desktop_state",
    state: {
      activeCameraId: camera.id,
      cameras: [{ id: camera.id, name: camera.name, phoneUpdatedAt: Date.now(), ...confirmedView }],
      phonePreviewRevision: 1,
      phonePreviewToken: "desktop-camera:1",
    },
  });
  await waitFor(() => expect(previewProbe.viewRef?.current).toEqual(confirmedView));
});

afterEach(() => {
  cleanup();
  setCharacterAnimationElapsedSnapshot(null);
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

it("keeps applying desktop character animation frames after replacing the phone preview scene", async () => {
  window.history.replaceState({}, "", "/phone?mode=standard");
  const project = createDefaultDirectorProject();
  const character = project.objects.find((object) => object.kind === "character")!;
  character.characterActionTrack = {
    actionId: "wave",
    duration: 5,
    loop: true,
    enabled: true,
    playbackMode: "normal",
  };
  const camera = project.cameras[0];
  const cameraSnapshot = getCameraViewSnapshotFromShot(camera);
  render(<PhoneController />);

  await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
  MockWebSocket.instances[0].receive({
    type: "desktop_state",
    state: {
      activeCameraId: camera.id,
      cameras: [{ id: camera.id, name: camera.name, ...cameraSnapshot }],
      phonePreviewRevision: 1,
      phonePreviewToken: "desktop-test:1",
      phonePreviewProject: project,
      characterAnimationElapsed: { [character.id]: 1.25 },
    },
  });

  await waitFor(() => expect(getCharacterActionElapsed(character.id)).toBe(1.25));
  expect(useDirectorStore.getState().project.objects.find((object) => object.id === character.id)?.characterActionTrack)
    .toMatchObject({ actionId: "wave", enabled: true });

  MockWebSocket.instances[0].receive({
    type: "desktop_state",
    state: {
      activeCameraId: camera.id,
      cameras: [{ id: camera.id, name: camera.name, ...cameraSnapshot }],
      phonePreviewRevision: 1,
      phonePreviewToken: "desktop-test:1",
      characterAnimationElapsed: { [character.id]: 2.5 },
    },
  });

  await waitFor(() => expect(getCharacterActionElapsed(character.id)).toBe(2.5));
});

it("keeps sensor controls out of the standard LAN controller", () => {
  window.history.replaceState({}, "", "/phone?mode=standard");
  render(<PhoneController />);

  expect(screen.getByRole("heading", { name: "手机摄影机" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "启用体感" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "全屏操控" })).toBeInTheDocument();
  expect(screen.getByLabelText("摄影机移动摇杆")).toBeInTheDocument();
});

it("sends an initial phone state after the WebSocket connection is ready", async () => {
  window.history.replaceState({}, "", "/phone?mode=standard");
  render(<PhoneController />);

  await waitFor(() => {
    expect(MockWebSocket.sent.map((payload) => JSON.parse(payload).type)).toEqual(["client_hello", "phone_state"]);
  });
});

it("sends the selected long recording duration with the camera state", async () => {
  window.history.replaceState({}, "", "/phone?mode=standard");
  render(<PhoneController />);

  fireEvent.click(screen.getByRole("button", { name: "15秒" }));
  fireEvent.click(screen.getByRole("button", { name: "录制15秒" }));

  await waitFor(() => {
    const phoneStates = MockWebSocket.sent
      .map((payload) => JSON.parse(payload))
      .filter((payload) => payload.type === "phone_state");
    expect(phoneStates[phoneStates.length - 1]?.payload).toMatchObject({ recording: true, recordingDuration: 15 });
  });
});

it("shows the secure motion controls only in motion mode", () => {
  window.history.replaceState({}, "", "/phone?mode=motion");
  render(<PhoneController />);

  expect(screen.getByRole("heading", { name: "体感摄影机" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "启用体感" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "校准体感" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "全屏操控" })).toBeInTheDocument();
});

it("uses the immersive layout even when the browser fullscreen API is unavailable, then exits it", () => {
  window.history.replaceState({}, "", "/phone?mode=standard");
  render(<PhoneController />);

  fireEvent.click(screen.getByRole("button", { name: "全屏操控" }));
  expect(document.body).toHaveClass("phone-immersive");
  expect(screen.getByRole("button", { name: "退出全屏" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "退出全屏" }));
  expect(document.body).not.toHaveClass("phone-immersive");
  expect(screen.getByRole("button", { name: "全屏操控" })).toBeInTheDocument();
});

it("forces a landscape layout when fullscreen starts from a portrait viewport", () => {
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("innerHeight", 844);
  window.history.replaceState({}, "", "/phone?mode=standard");
  render(<PhoneController />);

  fireEvent.click(screen.getByRole("button", { name: "全屏操控" }));
  expect(document.body).toHaveClass("phone-immersive", "phone-force-landscape");

  vi.stubGlobal("innerWidth", 844);
  vi.stubGlobal("innerHeight", 390);
  fireEvent(window, new Event("resize"));
  expect(document.body).toHaveClass("phone-immersive");
  expect(document.body).not.toHaveClass("phone-force-landscape");
});
