import { beforeEach, expect, it } from "vitest";
import { applySceneScript, exportSceneScript } from "./directorAgent";
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
