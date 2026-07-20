import { afterEach, beforeEach, expect, it } from "vitest";
import {
  applySceneScript,
  exportAnimationSequencePackage,
  exportCharacterPackage,
  exportSceneScript,
  executeDirectorAgentTool,
  importAnimationSequencePackage,
  importCharacterAnimationPackage,
  importCharacterPackage,
  reviewAnimationSequence,
  updateProp,
} from "./directorAgent";
import {
  getCharacterActionElapsed,
  isNormalCharacterAnimationPlaying,
  setCharacterAnimationElapsedSnapshot,
  stopNormalCharacterAnimations,
} from "../animation/characterAnimation";
import { createInitialDirectorState, useDirectorStore } from "../store/directorStore";
import { getAnimationSequenceRuntimeSnapshot, resetAnimationSequenceRuntime } from "../animation/animationSequence";
import danceExample from "../../../examples/animation-sequences/ai-dance-15s.json";
import fightExample from "../../../examples/animation-sequences/two-person-fight-10s.json";
import carJumpExample from "../../../examples/animation-sequences/car-jump-train-breakup-10s.json";
import transformerExample from "../../../examples/scene-scripts/crimson-transformer-showcase.json";
import trainChaseExample from "../../../examples/scene-scripts/train-station-car-chase-15s.json";
import alienParkExample from "../../../examples/scene-scripts/alien-park-abduction-15s.json";

beforeEach(() => {
  useDirectorStore.setState({
    ...useDirectorStore.getState(),
    ...createInitialDirectorState(),
  });
});

afterEach(() => {
  stopNormalCharacterAnimations();
  setCharacterAnimationElapsedSnapshot(null);
  resetAnimationSequenceRuntime();
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

it("round-trips an allowlisted procedural factory without importing executable code", () => {
  applySceneScript(transformerExample as never);

  updateProp({
    name: "赤曜变形机甲",
    factoryId: "crimson-transformer",
    factoryParameters: { morph: 0.35, autoTransform: true, transformDuration: 15 },
    position: [1, 0, -2],
  });

  const created = useDirectorStore.getState().project.objects.find((object) => object.name === "赤曜变形机甲");
  expect(created?.proceduralFactory).toEqual({
    id: "crimson-transformer",
    parameters: { morph: 0.35, autoTransform: true, transformDuration: 15 },
  });

  const exported = exportSceneScript();
  expect(exported.props?.[0]).toMatchObject({
    factoryId: "crimson-transformer",
    factoryParameters: { morph: 0.35, autoTransform: true, transformDuration: 15 },
  });

  applySceneScript(exported);
  const restored = useDirectorStore.getState().project.objects.find((object) => object.name === "赤曜变形机甲");
  expect(restored?.proceduralFactory?.id).toBe("crimson-transformer");
});

it("imports and exports the complete 15 second train chase scene", () => {
  applySceneScript(trainChaseExample as never);
  const scene = useDirectorStore.getState().project;
  const chase = scene.objects.find((object) => object.name === "火车站追车爆炸");

  expect(chase?.proceduralFactory).toMatchObject({
    id: "train-station-car-chase",
    parameters: { autoPlay: true, duration: 15, time: 0 },
  });
  expect(scene.cameras).toHaveLength(3);

  const exported = exportSceneScript();
  expect(exported.props?.[0]).toMatchObject({
    factoryId: "train-station-car-chase",
    factoryParameters: { autoPlay: true, duration: 15, time: 0 },
  });
});

it("imports and exports the complete 15 second park abduction scene", () => {
  applySceneScript(alienParkExample as never);
  const scene = useDirectorStore.getState().project;
  const abduction = scene.objects.find((object) => object.name === "公园飞碟劫持");

  expect(abduction?.proceduralFactory).toMatchObject({
    id: "alien-park-abduction",
    parameters: { autoPlay: true, duration: 15, time: 0 },
  });
  expect(scene.cameras).toHaveLength(3);
  expect(exportSceneScript().props?.[0]).toMatchObject({
    factoryId: "alien-park-abduction",
    factoryParameters: { autoPlay: true, duration: 15, time: 0 },
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
          duration: 15,
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

it("creates and round-trips the Codex light dance with automatic playback", async () => {
  applySceneScript({
    reset: true,
    characters: [
      {
        name: "轻快舞者",
        bodyType: "female",
        color: "#ec4899",
        action: {
          id: "light-dance",
          duration: 5,
          playbackMode: "normal",
          enabled: true,
        },
      },
    ],
  });

  const original = useDirectorStore.getState().project.objects.find((object) => object.name === "轻快舞者");
  expect(original?.characterActionTrack).toMatchObject({
    actionId: "light-dance",
    duration: 15,
    playbackMode: "normal",
    enabled: true,
  });
  expect(isNormalCharacterAnimationPlaying()).toBe(true);
  await new Promise((resolve) => window.setTimeout(resolve, 80));
  expect(getCharacterActionElapsed(original!.id)).toBeGreaterThan(0);

  const exported = exportSceneScript();
  expect(exported.characters?.[0]?.action).toMatchObject({
    id: "light-dance",
    duration: 15,
    playbackMode: "normal",
    enabled: true,
  });

  applySceneScript(exported);
  const restored = useDirectorStore.getState().project.objects.find((object) => object.name === "轻快舞者");
  expect(restored?.characterActionTrack?.actionId).toBe("light-dance");
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

it("builds procedural objects as whole movable assemblies without inheriting part dimensions", () => {
  const result = applySceneScript({
    reset: true,
    proceduralObjects: [
      {
        targetName: "测试汽车",
        directorPlacement: { position: [3, 0, -2] },
        directorAnimation: {
          duration: 15,
          enabled: true,
          playbackMode: "normal",
          path: { type: "linear", closed: true, points: [[3, 0, -2], [6, 0, -2]] },
        },
        materials: [{ id: "paint", baseColor: "#d23b32", roughness: 0.28, metalness: 0.42 }],
        componentTree: [
          {
            id: "body",
            name: "车身",
            primitive: "box",
            parent: null,
            material: "paint",
            dimensions: { width: 4.2, height: 0.8, depth: 1.8 },
            transform: { position: [0, 0.8, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          },
          {
            id: "wheel",
            name: "车轮",
            primitive: "torus",
            parent: null,
            material: "paint",
            dimensions: { width: 0.72, height: 0.72, depth: 0.24 },
            transform: { position: [-1.35, 0.42, 0.92], rotation: [0, 0, 0], scale: [1, 1, 1] },
          },
        ],
      },
    ],
  });

  const project = useDirectorStore.getState().project;
  const root = project.objects.find((object) => object.name === "测试汽车")!;
  const body = project.objects.find((object) => object.name === "车身")!;
  const wheel = project.objects.find((object) => object.name === "车轮")!;
  expect(result.proceduralWarnings).toEqual([]);
  expect(root).toMatchObject({
    kind: "group",
    transform: { position: [3, 0, -2] },
    assemblyRootId: root.id,
    assemblySelectionMode: "whole",
    objectAnimationTrack: { duration: 15, enabled: true, playbackMode: "normal" },
  });
  expect(body).toMatchObject({
    parentId: root.id,
    assemblyRootId: root.id,
    geometrySize: [4.2, 0.8, 1.8],
    transform: { scale: [1, 1, 1] },
  });
  expect(wheel.assemblyRootId).toBe(root.id);

  const exported = exportSceneScript();
  applySceneScript(exported);
  const restored = useDirectorStore.getState().project;
  const restoredRoot = restored.objects.find((object) => object.name === "测试汽车")!;
  expect(restoredRoot.assemblySelectionMode).toBe("whole");
  expect(restored.objects.find((object) => object.name === "车身")?.geometrySize).toEqual([4.2, 0.8, 1.8]);
  expect(restored.objects.find((object) => object.name === "车轮")?.assemblyRootId).toBe(restoredRoot.id);
});

it("imports an external multi-object animation package and round-trips its bindings and clips", () => {
  applySceneScript({
    reset: true,
    characters: [{ id: "hero", name: "男主" }],
    groups: [{ kind: "group", id: "car", name: "汽车", children: [{ id: "door", name: "车门", geometryType: "box" }] }],
  });

  const result = importAnimationSequencePackage({
    format: "storyai-animation-sequence",
    version: 1,
    sequence: {
      id: "sequence_action",
      name: "联合动画",
      duration: 10,
      playbackMode: "recording",
      loop: false,
      enabled: true,
      bindings: [
        { alias: "hero", objectId: "missing", objectName: "男主" },
        { alias: "door", objectId: "missing-door", objectName: "车门" },
      ],
      tracks: [
        { id: "hero_track", name: "男主动作", type: "character", binding: "hero", startTime: 0, endTime: 10, motionClipId: "clip_external" },
        { id: "door_track", name: "车门脱落", type: "object", binding: "door", startTime: 5, endTime: 10, keyframes: [{ time: 0, position: [0, 0, 0] }, { time: 5, position: [4, 2, 0] }] },
      ],
    },
    motionClips: [{
      id: "clip_external",
      binding: "hero",
      name: "外部动作",
      duration: 10,
      frames: [{ time: 0, controls: {} }, { time: 10, controls: { "body.yaw": 30 }, rootOffset: [1, 0, 0] }],
    }],
  });

  expect(result).toMatchObject({ name: "联合动画", trackCount: 2, warnings: [] });
  const sequence = useDirectorStore.getState().project.animationSequences?.[0]!;
  expect(sequence.bindings.every((binding) => !binding.objectId.startsWith("missing"))).toBe(true);
  const characterTrack = sequence.tracks.find((track) => track.type === "character");
  expect(characterTrack?.type).toBe("character");
  if (characterTrack?.type === "character") {
    expect(characterTrack.motionClipId).not.toBe("clip_external");
  }
  expect(reviewAnimationSequence(sequence.id).warnings).toEqual([]);
  expect(getAnimationSequenceRuntimeSnapshot()).toMatchObject({ sequenceId: sequence.id, playing: true });

  const exported = exportAnimationSequencePackage(sequence.id);
  useDirectorStore.getState().deleteAnimationSequence(sequence.id);
  importAnimationSequencePackage(exported);
  expect(useDirectorStore.getState().project.animationSequences?.[0]?.tracks).toHaveLength(2);
  expect(exportSceneScript().animationSequences).toHaveLength(1);
});

it("applies the shipped dance, fight, and car stunt animation examples", () => {
  const originalObjectIds = useDirectorStore.getState().project.objects.map((item) => item.id);
  importCharacterAnimationPackage(danceExample);
  const danceSequence = useDirectorStore.getState().project.animationSequences?.slice(-1)[0];
  expect(originalObjectIds.every((id) => useDirectorStore.getState().project.objects.some((item) => item.id === id))).toBe(true);
  expect(useDirectorStore.getState().project.objects.find((item) => item.name === "AI舞者")).toBeDefined();
  expect(danceSequence).toMatchObject({ duration: 15, playbackMode: "manual", loop: true });
  expect(getAnimationSequenceRuntimeSnapshot()).toMatchObject({
    sequenceId: danceSequence?.id,
    playing: true,
  });

  importCharacterAnimationPackage(fightExample);
  const fightSequence = useDirectorStore.getState().project.animationSequences?.slice(-1)[0];
  expect(useDirectorStore.getState().project.objects.filter((item) => item.kind === "character")).toHaveLength(4);
  expect(fightSequence).toMatchObject({
    duration: 10,
    playbackMode: "manual",
    loop: true,
  });
  expect(fightSequence?.tracks).toHaveLength(2);
  expect(getAnimationSequenceRuntimeSnapshot()).toMatchObject({ sequenceId: fightSequence?.id, playing: true });

  applySceneScript(carJumpExample as never);
  const state = useDirectorStore.getState();
  const carSequence = state.project.animationSequences?.[0];
  expect(carSequence).toMatchObject({
    duration: 10,
    playbackMode: "manual",
    loop: true,
  });
  expect(carSequence?.bindings).toHaveLength(7);
  expect(carSequence?.tracks).toHaveLength(7);
  expect(carSequence?.cameraId).toBe(state.project.activeCameraId);
  expect(carSequence?.bindings.every((binding) =>
    state.project.objects.some((item) => item.id === binding.objectId)
  )).toBe(true);
  expect(getAnimationSequenceRuntimeSnapshot()).toMatchObject({ sequenceId: carSequence?.id, playing: true });
});

it("applies a complete AI scene and its animation sequences as one undo batch", () => {
  useDirectorStore.setState({ undoStack: [] });
  const before = useDirectorStore.getState().project;

  applySceneScript(carJumpExample as never);

  expect(useDirectorStore.getState().undoStack).toHaveLength(1);
  useDirectorStore.getState().undo();
  expect(useDirectorStore.getState().project.objects).toEqual(before.objects);
  expect(useDirectorStore.getState().project.animationSequences).toEqual(before.animationSequences);
});

it("lets the agent list, assign, switch, and export character face clips", async () => {
  useDirectorStore.getState().addPresetCharacter("face-capture");
  const character = useDirectorStore.getState().project.objects.find((item) => item.bodyType === "face-capture")!;
  const clipId = useDirectorStore.getState().addCharacterFaceClip({
    characterId: character.id,
    name: "表情片段",
    duration: 5,
    fps: 30,
    channels: ["jawOpen"],
    frames: [{ time: 0, values: [0.4], headRotation: [0, 0, 0, 1] }],
    checksum: "face_agent",
  });
  await executeDirectorAgentTool("assign_face_clip", {
    characterId: character.id,
    clipId,
    profile: "gnm21",
  });
  expect(useDirectorStore.getState().project.objects.find((item) => item.id === character.id)?.characterFaceTrack).toMatchObject({
    clipId,
    profile: "gnm21",
    enabled: true,
    loop: true,
  });
  const listed = await executeDirectorAgentTool("list_face_clips") as { clips: Array<{ id: string }> };
  expect(listed.clips.map((clip) => clip.id)).toContain(clipId);
  const exported = await executeDirectorAgentTool("export_face_clip", { clipId }) as { faceAnimationPackage: { format: string } };
  expect(exported.faceAnimationPackage.format).toBe("storyai-face-animation");
});

it("keeps face clips on dedicated actors through character export and import", () => {
  useDirectorStore.getState().addPresetCharacter("face-capture");
  const character = useDirectorStore.getState().project.objects.find((item) => item.bodyType === "face-capture")!;
  const clipId = useDirectorStore.getState().addCharacterFaceClip({
    characterId: character.id,
    name: "专用演员表情",
    duration: 5,
    fps: 30,
    channels: ["jawOpen"],
    frames: [{ time: 0, values: [0.35], headRotation: [0, 0, 0, 1] }],
    checksum: "face_round_trip",
  });
  useDirectorStore.getState().setCharacterFaceTrack(character.id, {
    clipId,
    profile: "facecap52",
    enabled: true,
    loop: true,
  });

  const characterPackage = exportCharacterPackage(character.id);
  useDirectorStore.getState().resetDirectorDesk();
  const result = importCharacterPackage(characterPackage);
  const project = useDirectorStore.getState().project;
  const imported = project.objects.find((object) => object.id === result.id)!;
  const importedClip = project.characterFaceClips?.find((clip) => clip.characterId === imported.id);

  expect(imported).toMatchObject({ bodyType: "face-capture", characterRig: { rigType: "ue4-mannequin" } });
  expect(imported.characterFaceTrack).toMatchObject({ clipId: importedClip?.id, enabled: true, loop: true });
  expect(importedClip).toMatchObject({ name: "专用演员表情", channels: ["jawOpen"] });
});

it("rejects binding a face clip to an ordinary UE4 character", async () => {
  const character = useDirectorStore.getState().project.objects.find((item) => item.kind === "character")!;
  const clipId = useDirectorStore.getState().addCharacterFaceClip({
    characterId: character.id,
    name: "不应绑定的片段",
    duration: 5,
    fps: 30,
    channels: ["jawOpen"],
    frames: [{ time: 0, values: [0], headRotation: [0, 0, 0, 1] }],
    checksum: "face_reject",
  });

  await expect(executeDirectorAgentTool("assign_face_clip", { characterId: character.id, clipId })).rejects.toThrow(
    "普通角色保留原始头部"
  );
});
