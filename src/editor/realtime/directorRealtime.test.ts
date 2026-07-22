import { expect, it } from "vitest";
import type { DirectorProject } from "../schema/directorProject";
import { createPhonePreviewProject, createPhonePreviewToken, getPhonePreviewFingerprint } from "./directorRealtime";

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

it("keeps the active unified animation sequence in the phone preview", () => {
  const animatedProject: DirectorProject = {
    ...project,
    animationSequences: [{
      id: "sequence-1",
      name: "桌椅动画",
      duration: 10,
      playbackMode: "recording",
      loop: true,
      enabled: true,
      cameraId: null,
      bindings: [{ alias: "table", objectId: "prop-1", objectName: "桌子" }],
      tracks: [{
        id: "track-1",
        name: "桌子移动",
        type: "object",
        binding: "table",
        startTime: 0,
        endTime: 10,
        loop: false,
        blendIn: 0,
        blendOut: 0,
        keyframes: [
          { time: 0, position: [0, 0, 0] },
          { time: 10, position: [2, 0, 0] },
        ],
      }],
    }],
    activeAnimationSequenceId: "sequence-1",
  };

  const preview = createPhonePreviewProject(animatedProject);

  expect(preview.animationSequences).toEqual(animatedProject.animationSequences);
  expect(preview.activeAnimationSequenceId).toBe("sequence-1");
});

it("syncs face clips once and invalidates the phone preview when their content changes", () => {
  const faceClip = {
    id: "face-1",
    characterId: "character-1",
    name: "微笑",
    duration: 5,
    fps: 30,
    channels: ["mouthSmileLeft", "mouthSmileRight"],
    frames: [
      { time: 0, values: [0, 0], headRotation: [0, 0, 0, 1] as [number, number, number, number] },
      { time: 5, values: [1, 1], headRotation: [0, 0, 0, 1] as [number, number, number, number] },
    ],
    checksum: "face_initial",
  };
  const faceActor = {
    id: "character-1",
    name: "面捕演员",
    kind: "character" as const,
    visible: true,
    locked: false,
    bodyType: "face-capture" as const,
    transform: {
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    },
    characterFaceTrack: { clipId: faceClip.id, profile: "facecap52" as const, enabled: true, loop: true },
  };
  const unusedFaceClip = { ...faceClip, id: "face-unused", checksum: "face_unused" };
  const faceProject: DirectorProject = {
    ...project,
    objects: [...project.objects, faceActor],
    characterFaceClips: [faceClip, unusedFaceClip],
  };
  const revisedProject: DirectorProject = {
    ...faceProject,
    characterFaceClips: [{ ...faceClip, checksum: "face_revised" }, unusedFaceClip],
  };

  expect(createPhonePreviewProject(faceProject).characterFaceClips).toEqual([faceClip]);
  expect(getPhonePreviewFingerprint(revisedProject)).not.toBe(getPhonePreviewFingerprint(faceProject));
});

it("keeps a dedicated facial capture actor and its binding in the phone scene", () => {
  const faceActor = {
    id: "face-actor-1",
    name: "面捕演员01",
    kind: "character" as const,
    visible: true,
    locked: false,
    bodyType: "face-capture" as const,
    color: "#315C78",
    transform: {
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    },
    characterRig: { rigType: "ue4-mannequin" as const, posePresetId: "stand", controls: {} },
    characterFaceTrack: { clipId: null, profile: "facecap52" as const, enabled: false, loop: true },
  };
  const faceProject: DirectorProject = { ...project, objects: [...project.objects, faceActor] };
  const preview = createPhonePreviewProject(faceProject);

  expect(preview.objects.find((object) => object.id === faceActor.id)).toMatchObject({
    bodyType: "face-capture",
    characterRig: { rigType: "ue4-mannequin" },
    characterFaceTrack: { profile: "facecap52" },
  });
  expect(getPhonePreviewFingerprint(faceProject)).toContain("face-capture");
});

it("gives every desktop scene revision a session-qualified phone preview token", () => {
  expect(createPhonePreviewToken("desktop-a", 2)).toBe("desktop-a:2");
  expect(createPhonePreviewToken("desktop-a", 2)).not.toBe(createPhonePreviewToken("desktop-b", 2));
});
