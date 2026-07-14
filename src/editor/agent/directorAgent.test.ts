import { beforeEach, expect, it } from "vitest";
import { applySceneScript, exportCharacterPackage, exportSceneScript, importCharacterPackage } from "./directorAgent";
import { createInitialDirectorState, useDirectorStore } from "../store/directorStore";

beforeEach(() => {
  useDirectorStore.setState({
    ...useDirectorStore.getState(),
    ...createInitialDirectorState(),
  });
});

it("restores a panorama and remaps exported camera animation ids during a reset import", () => {
  applySceneScript({
    reset: true,
    scene: { panoramaYaw: 24, showGrid: false },
    panorama: {
      name: "茶室全景",
      fileName: "tea-room.jpg",
      url: "data:image/jpeg;base64,panorama",
      projectionMode: "equirectangular",
    },
    cameras: [
      {
        id: "camera_from_script",
        name: "对坐机位",
        position: [0, 1.6, 4],
        lookAt: [0, 1.2, 0],
        fov: 40,
      },
    ],
    activeCameraId: "camera_from_script",
    cameraAnimations: [
      {
        id: "animation_from_script",
        name: "手机轨迹",
        cameraId: "camera_from_script",
        keyframes: [
          { time: 0, position: [0, 1.6, 4], target: [0, 1.2, 0], fov: 40 },
          { time: 1000, position: [1, 1.6, 3], target: [0, 1.2, 0], fov: 40 },
        ],
      },
    ],
  });

  const project = useDirectorStore.getState().project;
  const camera = project.cameras[0]!;
  const panorama = project.assets.find((asset) => asset.id === project.panoramaAssetId);

  expect(project.activeCameraId).toBe(camera.id);
  expect(project.cameraAnimations[0]?.cameraId).toBe(camera.id);
  expect(project.scene.panoramaYaw).toBe(24);
  expect(project.scene.showGrid).toBe(false);
  expect(panorama).toMatchObject({ fileName: "tea-room.jpg", url: "data:image/jpeg;base64,panorama" });
  expect(exportSceneScript().panorama).toMatchObject({ fileName: "tea-room.jpg", url: "data:image/jpeg;base64,panorama" });
});

it("round-trips manually edited pose controls through scene scripts", () => {
  applySceneScript({
    reset: true,
    characters: [
      {
        name: "手动姿势角色",
        pose: "stand",
        poseControls: {
          "leftShoulder.pitch": 37,
          "rightElbow.bend": 64,
          "head.yaw": -18,
        },
      },
    ],
  });

  const exported = exportSceneScript();
  expect(exported.characters?.[0]?.poseControls).toMatchObject({
    "leftShoulder.pitch": 37,
    "rightElbow.bend": 64,
    "head.yaw": -18,
  });

  applySceneScript(exported);
  const restored = useDirectorStore.getState().project.objects.find((object) => object.kind === "character");
  expect(restored?.characterRig?.posePresetId).toBeNull();
  expect(restored?.characterRig?.controls).toMatchObject({
    "leftShoulder.pitch": 37,
    "rightElbow.bend": 64,
    "head.yaw": -18,
  });
});

it("round-trips a reusable character package with color, pose, and video motion frames", () => {
  applySceneScript({
    reset: true,
    characters: [
      {
        name: "可复用女主",
        bodyType: "female",
        color: "#d94c73",
        poseControls: { "head.yaw": 16, "leftElbow.bend": 42 },
        action: { id: "idle", duration: 5, source: "video", enabled: true },
        motionClip: {
          name: "挥手视频动作",
          duration: 5,
          frames: [
            { time: 0, controls: { "rightShoulder.pitch": 10 } },
            { time: 5, controls: { "rightShoulder.pitch": 65 } },
          ],
        },
      },
    ],
  });

  const original = useDirectorStore.getState().project.objects.find((object) => object.name === "可复用女主")!;
  const characterPackage = exportCharacterPackage(original.id);
  useDirectorStore.getState().resetDirectorDesk();
  const result = importCharacterPackage(characterPackage);

  const project = useDirectorStore.getState().project;
  const imported = project.objects.find((object) => object.id === result.id)!;
  const clip = project.characterMotionClips?.find((candidate) => candidate.id === imported.characterActionTrack?.motionClipId);
  expect(imported.color).toBe("#d94c73");
  expect(imported.characterRig?.controls).toMatchObject({ "head.yaw": 16, "leftElbow.bend": 42 });
  expect(imported.characterActionTrack?.source).toBe("video");
  expect(clip?.name).toBe("挥手视频动作");
  expect(clip?.frames).toHaveLength(2);
});

it("creates and round-trips structured animated assemblies", () => {
  applySceneScript({
    reset: true,
    groups: [
      {
        kind: "group",
        id: "train",
        name: "火车",
        animation: {
          duration: 10,
          playbackMode: "recording-sync",
          path: {
            type: "curve",
            closed: true,
            orientToPath: true,
            points: [
              [0, 0, 0],
              [5, 0, 0],
              [5, 0, 5],
              [0, 0, 5],
            ],
          },
        },
        children: [
          { id: "body", name: "车身", geometryType: "rounded-box", scale: [3, 1, 1] },
          {
            id: "wheel",
            name: "车轮",
            geometryType: "disc",
            position: [-1, 0, 0.55],
            repeat: { count: 3, offset: [1, 0, 0] },
            mirror: { axis: "z" },
            animation: {
              duration: 5,
              keyframes: [
                { time: 0, rotation: [0, 0, 0] },
                { time: 5, rotation: [Math.PI * 2, 0, 0] },
              ],
            },
          },
        ],
      },
      {
        kind: "group",
        id: "door-frame",
        name: "门组",
        children: [
          {
            id: "door-panel",
            name: "门板",
            geometryType: "box",
            scale: [1, 2, 0.08],
            pivot: [-0.5, 0, 0],
            animation: {
              duration: 5,
              keyframes: [
                { time: 0, rotation: [0, 0, 0] },
                { time: 5, rotation: [0, Math.PI / 2, 0] },
              ],
            },
          },
        ],
      },
    ],
  });

  const project = useDirectorStore.getState().project;
  const train = project.objects.find((object) => object.name === "火车");
  const wheels = project.objects.filter((object) => object.name.includes("车轮"));
  const door = project.objects.find((object) => object.name === "门板");
  expect(train?.kind).toBe("group");
  expect(train?.objectAnimationTrack?.playbackMode).toBe("recording-sync");
  expect(wheels).toHaveLength(6);
  expect(wheels.every((wheel) => wheel.parentId === train?.id)).toBe(true);
  expect(door?.pivot).toEqual([-0.5, 0, 0]);

  const exported = exportSceneScript();
  applySceneScript(exported);
  const restored = useDirectorStore.getState().project;
  const restoredTrain = restored.objects.find((object) => object.name === "火车");
  expect(restoredTrain?.objectAnimationTrack?.path?.closed).toBe(true);
  expect(restored.objects.find((object) => object.name === "门板")?.pivot).toEqual([-0.5, 0, 0]);
  expect(restored.objects.filter((object) => object.name.includes("车轮"))).toHaveLength(6);
});
