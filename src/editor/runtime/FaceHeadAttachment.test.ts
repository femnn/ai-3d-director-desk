import { BufferGeometry, Group, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from "three";
import { expect, it } from "vitest";
import { applyFaceSampleToMorphMeshes, isolateFaceModelInstance } from "./FaceHeadAttachment";

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

it("isolates morph state for multiple face-capture actors", () => {
  const source = new Group();
  const sourceMesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
  sourceMesh.morphTargetDictionary = { jawOpen: 0 };
  sourceMesh.morphTargetInfluences = [0];
  source.add(sourceMesh);
  const first = isolateFaceModelInstance(source.clone(true));
  const second = isolateFaceModelInstance(source.clone(true));
  const firstMesh = first.children[0] as Mesh;
  const secondMesh = second.children[0] as Mesh;

  applyFaceSampleToMorphMeshes(null, [firstMesh], {
    influences: { jawOpen: 0.8 },
    headRotation: [0, 0, 0, 1],
  });

  expect(firstMesh.geometry).not.toBe(secondMesh.geometry);
  expect(firstMesh.material).not.toBe(secondMesh.material);
  expect(firstMesh.morphTargetInfluences).not.toBe(secondMesh.morphTargetInfluences);
  expect(firstMesh.morphTargetInfluences).toEqual([0.8]);
  expect(secondMesh.morphTargetInfluences).toEqual([0]);
});
