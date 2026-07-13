import { expect, it } from "vitest";
import type { DirectorProject } from "../schema/directorProject";
import { createPhonePreviewProject, getPhonePreviewFingerprint } from "./directorRealtime";

const project: DirectorProject = {
  version: 1,
  scene: {
    scale: 1,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    backgroundColor: "#111111",
    panoramaYaw: 0,
    panoramaRadius: 30,
    showLabels: true,
    snapToGrid: true,
    showGrid: true,
    showGround: true,
    groundOpacity: 1,
    groundHeight: 0,
  },
  assets: [
    {
      id: "panorama",
      kind: "panorama",
      sourceType: "image",
      fileName: "night.jpg",
      url: `data:image/jpeg;base64,${"a".repeat(2_000_001)}`,
    },
    {
      id: "local-model",
      kind: "prop",
      sourceType: "model",
      fileName: "desk.fbx",
      url: "data:application/octet-stream;base64,model",
      assetSource: "local",
    },
    {
      id: "unused-model",
      kind: "prop",
      sourceType: "model",
      fileName: "unused.fbx",
      url: "data:application/octet-stream;base64,unused",
      assetSource: "local",
    },
  ],
  objects: [
    {
      id: "prop-1",
      name: "桌子",
      kind: "prop",
      visible: true,
      locked: false,
      assetRefId: "local-model",
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    },
    {
      id: "camera-object",
      name: "机位",
      kind: "camera",
      visible: true,
      locked: false,
      linkedCameraId: "cam-1",
      transform: { position: [0, 1.6, 4], rotation: [0, 0, 0], scale: [1, 1, 1] },
    },
  ],
  cameras: [],
  cameraAnimations: [],
  activeCameraId: null,
  panoramaAssetId: "panorama",
};

it("keeps the complete scene assets for the phone renderer while omitting editor camera rigs", () => {
  const preview = createPhonePreviewProject(project);

  expect(preview.assets.map((asset) => asset.id)).toEqual(["panorama", "local-model"]);
  expect(preview.panoramaAssetId).toBe("panorama");
  expect(preview.objects.map((item) => item.id)).toEqual(["prop-1"]);
});

it("does not treat phone camera rig updates as a new scene preview", () => {
  const cameraMovedProject: DirectorProject = {
    ...project,
    objects: project.objects.map((item) =>
      item.kind === "camera"
        ? { ...item, transform: { ...item.transform, position: [4, 1.6, 2] } }
        : item
    ),
  };

  expect(getPhonePreviewFingerprint(cameraMovedProject)).toBe(getPhonePreviewFingerprint(project));
});
