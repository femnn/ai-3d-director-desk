import { expect, it } from "vitest";
import { createAlienParkAbduction } from "./alienParkAbductionFactory";

it("animates two seated visitors before a UFO abducts one of them", () => {
  const runtime = createAlienParkAbduction();
  const beam = runtime.root.getObjectByName("ufo-abduction-beam");

  runtime.setTime(0, 15);
  expect(runtime.ufo.visible).toBe(false);
  expect(runtime.visitor.leftUpperLeg.rotation.x).toBeCloseTo(-Math.PI / 2);
  expect(runtime.abductee.root.position.y).toBeCloseTo(1.06);

  runtime.setTime(9.8, 15);
  expect(runtime.ufo.visible).toBe(true);
  expect(beam?.visible).toBe(true);
  expect(runtime.abductee.root.position.y).toBeGreaterThan(2.5);
  expect(runtime.visitor.root.position.x).toBeLessThan(-1.5);

  runtime.setTime(13.2, 15);
  expect(runtime.abductee.root.position.y).toBeGreaterThan(5);
  expect(runtime.abductee.root.scale.x).toBeLessThan(0.7);
  runtime.root.traverse((part) => {
    expect(part.position.toArray().every(Number.isFinite)).toBe(true);
  });
});
