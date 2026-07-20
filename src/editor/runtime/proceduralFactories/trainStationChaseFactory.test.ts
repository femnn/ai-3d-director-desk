import { expect, it } from "vitest";
import { createTrainStationChase } from "./trainStationChaseFactory";

it("plays a deterministic train chase, car jump, and explosion on one timeline", () => {
  const runtime = createTrainStationChase();
  const explosion = runtime.root.getObjectByName("car-explosion");
  const fragment = runtime.root.getObjectByName("car-fragment-0");

  expect(runtime.train.children).toHaveLength(4);
  expect(runtime.root.getObjectByName("near-platform")).toBeTruthy();

  runtime.setTime(0, 15);
  expect(runtime.train.position.x).toBeCloseTo(-5.5);
  expect(runtime.car.position.z).toBeCloseTo(5.75);
  expect(runtime.car.visible).toBe(true);

  runtime.setTime(8.6, 15);
  expect(runtime.car.position.y).toBeGreaterThan(4.8);
  expect(Math.abs(runtime.car.position.z)).toBeLessThan(0.2);

  runtime.setTime(12, 15);
  expect(runtime.car.visible).toBe(false);
  expect(explosion?.visible).toBe(true);
  expect(fragment?.scale.x).toBeGreaterThan(0.5);
  runtime.root.traverse((part) => {
    expect(part.position.toArray().every(Number.isFinite)).toBe(true);
  });
});
