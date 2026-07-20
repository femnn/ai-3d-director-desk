import { expect, it } from "vitest";
import { getMonitorCaptureDpr } from "./CameraMonitor";

it("keeps the monitor recording canvas near qHD when the floating window is resized", () => {
  expect(getMonitorCaptureDpr(320)).toBe(3);
  expect(620 * getMonitorCaptureDpr(620)).toBeCloseTo(960, 5);
  expect(getMonitorCaptureDpr(220)).toBe(3);
});
