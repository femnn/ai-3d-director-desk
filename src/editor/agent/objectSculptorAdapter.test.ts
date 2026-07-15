import { expect, it } from "vitest";
import { convertObjectSculptSpecToSceneScript, isObjectSculptSpec } from "./objectSculptorAdapter";

const SPEC = {
  targetName: "电影摄影灯",
  directorPlacement: { position: [2, 0, -1] },
  materials: [
    { id: "black-metal", baseColor: "#25282d", roughness: { base: 0.24 }, metalness: 0.82 },
    { id: "glass", baseColor: "#f4d38a", roughness: 0.18, metalness: 0, opacity: 0.72 },
  ],
  componentTree: [
    {
      id: "body",
      name: "灯体",
      primitive: "box",
      parent: null,
      material: "black-metal",
      dimensions: { width: 1.2, height: 0.8, depth: 0.7 },
      transform: { position: [0, 1.8, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      geometryDescriptor: { edgeTreatment: { bevelRadius: 0.08 } },
      actionProfile: { pivot: { localPosition: [0, 0, -0.3] } },
    },
    {
      id: "lens",
      name: "菲涅尔镜片",
      primitive: "cylinder",
      parent: "body",
      material: "glass",
      dimensions: { width: 0.58, height: 0.12, depth: 0.58 },
      transform: { position: [0, 0, 0.4], rotation: [1.5708, 0, 0], scale: [1, 1, 1] },
    },
  ],
};

it("recognizes and converts an ObjectSculptSpec into an editable local hierarchy", () => {
  expect(isObjectSculptSpec(SPEC)).toBe(true);
  const { script, warnings } = convertObjectSculptSpecToSceneScript(SPEC);
  const root = script.groups?.[0];
  const body = root?.children?.[0];
  const lens = body && "children" in body ? body.children?.[0] : undefined;

  expect(warnings).toEqual([]);
  expect(root).toMatchObject({ name: "电影摄影灯", position: [2, 0, -1] });
  expect(script.scenePlan).toBeUndefined();
  expect(body).toMatchObject({
    id: "body",
    geometryType: "rounded-box",
    geometryAnchor: "center",
    scale: [1, 1, 1],
    geometrySize: [1.2, 0.8, 0.7],
    color: "#25282d",
    material: { roughness: 0.24, metalness: 0.82, opacity: 1 },
    pivot: [0, 0, -0.3],
  });
  expect(lens).toMatchObject({ id: "lens", geometryType: "cylinder", color: "#f4d38a", material: { opacity: 0.72 } });
  expect(root).toMatchObject({ selectionMode: "whole" });
});

it("rejects invalid parent references instead of creating detached parts", () => {
  expect(() => convertObjectSculptSpecToSceneScript({
    ...SPEC,
    componentTree: [{ id: "handle", primitive: "capsule", parent: "missing" }],
  })).toThrow(/不存在的父级/);
});
