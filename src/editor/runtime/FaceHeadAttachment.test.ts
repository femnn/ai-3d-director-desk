import { BufferGeometry, Group, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from "three";
import { expect, it } from "vitest";
import { applyFaceSampleToMorphMeshes } from "./FaceHeadAttachment";

it("applies the current face frame before rendering and clears the previous frame", () => {
  const root = new Group();
  const mesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
  mesh.morphTargetDictionary = { jawOpen: 0, eyeBlink_L: 1 };
  mesh.morphTargetInfluences = [0.8, 0.6];
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.35);

  applyFaceSampleToMorphMeshes(root, [mesh], {
    influences: { jawOpen: 0.45 },
    headRotation: [rotation.x, rotation.y, rotation.z, rotation.w],
  });

  expect(mesh.morphTargetInfluences).toEqual([0.45, 0]);
  expect(root.quaternion.angleTo(rotation)).toBeLessThan(0.00001);
});
