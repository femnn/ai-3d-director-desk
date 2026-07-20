import { expect, it } from "vitest";
import { createCrimsonTransformer } from "./crimsonTransformerFactory";

it("builds a detailed transformer and interpolates between vehicle and robot poses", () => {
  const runtime = createCrimsonTransformer("#b32632");
  const head = runtime.root.getObjectByName("robot-head");

  expect(runtime.wheelSpinners).toHaveLength(4);
  expect(head).toBeTruthy();
  expect(runtime.root.children.length).toBeGreaterThan(25);

  runtime.setMorph(0);
  expect(head?.scale.x).toBeCloseTo(0.001);

  runtime.setMorph(1);
  expect(head?.position.y).toBeCloseTo(4.92);
  expect(head?.scale.x).toBeCloseTo(1);
  runtime.root.traverse((part) => {
    expect(part.position.toArray().every(Number.isFinite)).toBe(true);
  });
});
