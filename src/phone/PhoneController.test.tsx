import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PhoneController } from "./PhoneController";

vi.mock("./PhoneCameraPreview", () => ({
  PhoneCameraPreview: ({ onCameraChange }: { onCameraChange: (cameraId: string) => void }) => (
    <div aria-label="我的机位画面">
      <select aria-label="切换控制机位" onChange={(event) => onCameraChange(event.currentTarget.value)} />
    </div>
  ),
}));

class MockWebSocket {
  static readonly OPEN = 1;
  static sent: string[] = [];
  readonly readyState = MockWebSocket.OPEN;

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (type === "open") queueMicrotask(() => listener(new MessageEvent("open")));
  }

  close() {}

  send(payload: string) {
    MockWebSocket.sent.push(payload);
  }
}

beforeEach(() => {
  MockWebSocket.sent = [];
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
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
