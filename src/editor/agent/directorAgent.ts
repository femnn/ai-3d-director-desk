import { MANNEQUIN_POSE_PRESETS } from "../presets/mannequinPosePresets";
import {
  createDefaultDirectorProject,
  useDirectorStore,
  type CameraShotSnapshot,
} from "../store/directorStore";
import { requestViewportCapture } from "../io/captureBridge";
import { serializeProject } from "../io/exportProjectJson";
import { playCameraAnimation } from "../phone/phoneCameraControl";
import { getCameraRigPositionFromViewSnapshot, getCameraViewSnapshotFromShot } from "../schema/cameraGeometry";
import type {
  CharacterActionId,
  CharacterActionPlaybackMode,
  CharacterBodyType,
  CharacterMotionFrame,
  CharacterMotionClip,
  CharacterMotionSource,
  CharacterRigType,
  DirectorAssetSource,
  DirectorCameraAnimation,
  DirectorAnimationSequence,
  DirectorObject,
  DirectorMaterialSettings,
  DirectorProject,
  DirectorTransform,
  GeometryPrimitiveType,
  ObjectAnimationPlaybackMode,
  ObjectAnimationTrack,
  PanoramaProjectionMode,
  ScenePlan,
} from "../schema/directorProject";
import {
  convertObjectSculptSpecToSceneScript,
  isObjectSculptSpec,
  type ObjectSculptSpec,
} from "./objectSculptorAdapter";
import {
  CHARACTER_ACTION_OPTIONS,
  MIN_CHARACTER_ACTION_DURATION,
  getDefaultCharacterActionDuration,
  syncNormalCharacterAnimations,
} from "../animation/characterAnimation";
import type { PosePresetId } from "../schema/poseSchema";
import {
  pauseAnimationSequence,
  playAnimationSequence,
  scrubAnimationSequence,
} from "../animation/animationSequence";

type NumberTuple3 = [number, number, number];

export interface SceneScriptCharacter {
  id?: string;
  name?: string;
  type?: CharacterBodyType | "builtIn";
  bodyType?: CharacterBodyType;
  color?: string;
  rigType?: CharacterRigType;
  pose?: string;
  poseControls?: Record<string, number>;
  position?: number[];
  rotation?: number[];
  rotationY?: number;
  scale?: number | number[];
  action?: {
    id?: CharacterActionId;
    duration?: number;
    playbackMode?: CharacterActionPlaybackMode;
    cameraId?: string | null;
    enabled?: boolean;
    source?: CharacterMotionSource;
    motionClipId?: string | null;
  };
  motionClip?: SceneScriptCharacterMotionClip;
  asset?: SceneScriptCharacterAsset | null;
}

export interface SceneScriptCharacterMotionClip {
  name?: string;
  duration?: number;
  frames?: CharacterMotionFrame[];
}

export interface SceneScriptCharacterAsset {
  name?: string;
  fileName: string;
  url: string;
  assetSource?: DirectorAssetSource;
  animated?: boolean;
}

export interface CharacterPackage {
  format: "storyai-character";
  version: 1;
  character: SceneScriptCharacter;
}

export interface SceneScriptProp {
  id?: string;
  name?: string;
  type?: string;
  geometryType?: GeometryPrimitiveType;
  position?: number[];
  rotation?: number[];
  rotationY?: number;
  scale?: number | number[];
  color?: string;
  geometryAnchor?: "base" | "center";
  geometrySize?: number[];
  material?: DirectorMaterialSettings;
  parentId?: string | null;
  pivot?: number[];
  animation?: SceneScriptObjectAnimation;
  repeat?: {
    count: number;
    offset: number[];
    rotationStep?: number[];
    scaleStep?: number[];
  };
  mirror?: { axis: "x" | "y" | "z" | Array<"x" | "y" | "z"> };
  pathCopy?: { points: number[][]; count: number; orientToPath?: boolean };
  children?: Array<SceneScriptGroup | SceneScriptProp>;
}

export interface SceneScriptObjectAnimation {
  id?: string;
  name?: string;
  duration?: number;
  loop?: boolean;
  enabled?: boolean;
  playbackMode?: ObjectAnimationPlaybackMode;
  cameraId?: string | null;
  keyframes?: ObjectAnimationTrack["keyframes"];
  path?: ObjectAnimationTrack["path"];
}

export interface SceneScriptGroup {
  kind?: "group";
  id?: string;
  name?: string;
  position?: number[];
  rotation?: number[];
  rotationY?: number;
  scale?: number | number[];
  pivot?: number[];
  parentId?: string | null;
  selectionMode?: "whole" | "parts";
  animation?: SceneScriptObjectAnimation;
  children?: Array<SceneScriptGroup | SceneScriptProp>;
}

export interface SceneScriptCamera {
  id?: string;
  name?: string;
  position?: number[];
  target?: number[];
  lookAt?: number[];
  fov?: number;
}

export interface SceneScriptPanorama {
  name?: string;
  fileName?: string;
  url?: string;
  projectionMode?: PanoramaProjectionMode;
}

export interface SceneScript {
  reset?: boolean;
  characters?: SceneScriptCharacter[];
  props?: SceneScriptProp[];
  groups?: SceneScriptGroup[];
  proceduralObjects?: ObjectSculptSpec[];
  camera?: SceneScriptCamera;
  cameras?: SceneScriptCamera[];
  directorView?: SceneScriptCamera;
  activeCameraId?: string | null;
  cameraAnimations?: DirectorCameraAnimation[];
  animationSequences?: Array<DirectorAnimationSequence | AnimationSequencePackage>;
  panorama?: SceneScriptPanorama | null;
  scene?: Partial<DirectorProject["scene"]>;
  scenePlan?: ScenePlan | null;
}

export interface AnimationSequenceMotionClipInput extends Omit<CharacterMotionClip, "characterId"> {
  binding: string;
}

export interface AnimationSequencePackage {
  format: "storyai-animation-sequence";
  version: 1;
  sequence: DirectorAnimationSequence;
  motionClips?: AnimationSequenceMotionClipInput[];
}

type AgentToolResult = Record<string, unknown> | string;

const BODY_TYPES: CharacterBodyType[] = [
  "mannequin",
  "female",
  "broad",
  "muscular",
  "slim",
  "teen",
  "child",
  "chibi",
];

const PROP_PRESETS: Record<
  string,
  {
    geometryType: GeometryPrimitiveType;
    name: string;
    scale: NumberTuple3;
    color: string;
  }
> = {
  table: { geometryType: "box", name: "桌子", scale: [1.8, 0.12, 0.9], color: "#8B6B4A" },
  chair: { geometryType: "box", name: "椅子", scale: [0.55, 0.9, 0.55], color: "#6E7F8D" },
  wall: { geometryType: "box", name: "墙面", scale: [4, 2.4, 0.08], color: "#D6DEE8" },
  door: { geometryType: "box", name: "门框", scale: [1.1, 2.2, 0.08], color: "#9B6A3D" },
  marker: { geometryType: "cylinder", name: "标记点", scale: [0.35, 0.04, 0.35], color: "#F2A900" },
};

function toTuple3(value: unknown, fallback: NumberTuple3): NumberTuple3 {
  if (!Array.isArray(value)) return fallback;
  const next = value.slice(0, 3).map((item, index) => {
    const numberValue = typeof item === "number" && Number.isFinite(item) ? item : fallback[index];
    return Number(numberValue.toFixed(4));
  });
  while (next.length < 3) next.push(fallback[next.length]);
  return next as NumberTuple3;
}

function toScaleTuple(value: unknown, fallback: NumberTuple3): NumberTuple3 {
  if (typeof value === "number" && Number.isFinite(value)) return [value, value, value];
  return toTuple3(value, fallback);
}

function normalizeRotation(input: { rotation?: number[]; rotationY?: number }, fallback: NumberTuple3): NumberTuple3 {
  const rotation = toTuple3(input.rotation, fallback);
  if (typeof input.rotationY === "number" && Number.isFinite(input.rotationY)) {
    rotation[1] = input.rotationY;
  }
  return rotation;
}

function normalizePoseId(pose: unknown): PosePresetId | null {
  if (typeof pose !== "string") return null;
  const normalized = pose.trim().toLowerCase();
  const preset = MANNEQUIN_POSE_PRESETS.find(
    (item) => item.id.toLowerCase() === normalized || item.label.toLowerCase() === normalized
  );
  return preset?.id ?? null;
}

function normalizeBodyType(value: unknown): CharacterBodyType {
  if (typeof value === "string" && BODY_TYPES.includes(value as CharacterBodyType)) {
    return value as CharacterBodyType;
  }
  return "mannequin";
}

function normalizePoseControls(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const controls = Object.fromEntries(
    Object.entries(value).filter(([, control]) => typeof control === "number" && Number.isFinite(control))
  ) as Record<string, number>;
  return Object.keys(controls).length ? controls : null;
}

function normalizeActionId(value: unknown): CharacterActionId {
  if (typeof value === "string" && CHARACTER_ACTION_OPTIONS.some((action) => action.id === value)) {
    return value as CharacterActionId;
  }
  return "idle";
}

function applyCharacterAction(id: string, action: SceneScriptCharacter["action"], motionClipId?: string | null) {
  if (!action) return;
  const actionId = normalizeActionId(action.id);
  const minimumDuration = getDefaultCharacterActionDuration(actionId);
  useDirectorStore.getState().setCharacterActionTrack(id, {
    actionId,
    duration: Math.max(Number(action.duration ?? minimumDuration), minimumDuration),
    loop: true,
    playbackMode: action.playbackMode === "camera-driven" ? "camera-driven" : "normal",
    cameraId: typeof action.cameraId === "string" ? action.cameraId : null,
    enabled: action.enabled !== false,
    source: action.source === "video" || action.source === "mocap" ? action.source : "built-in",
    motionClipId: motionClipId ?? (typeof action.motionClipId === "string" ? action.motionClipId : null),
  });
  syncImportedNormalCharacterAnimations();
}

function syncImportedNormalCharacterAnimations() {
  const ids = useDirectorStore.getState().project.objects
    .filter(
      (object) =>
        object.kind === "character" &&
        object.characterActionTrack?.enabled &&
        object.characterActionTrack.playbackMode === "normal"
    )
    .map((object) => object.id);
  syncNormalCharacterAnimations(ids);
}

function importCharacterMotionClip(characterId: string, input: SceneScriptCharacterMotionClip | undefined) {
  if (!input || !Array.isArray(input.frames) || input.frames.length === 0) return null;
  const frames = input.frames
    .filter((frame) => frame && Number.isFinite(frame.time) && frame.controls && typeof frame.controls === "object")
    .map((frame) => ({
      time: Math.max(0, Number(frame.time)),
      controls: Object.fromEntries(
        Object.entries(frame.controls).filter(([, value]) => typeof value === "number" && Number.isFinite(value))
      ),
    }))
    .sort((a, b) => a.time - b.time);
  if (!frames.length) return null;
  const requestedDuration = Number(input.duration ?? frames[frames.length - 1]?.time ?? 5);
  return useDirectorStore.getState().addCharacterMotionClip({
    characterId,
    name: input.name?.trim() || "导入角色动作",
    duration: Math.max(requestedDuration, 0.1),
    frames,
  });
}

function normalizeObjectAnimation(
  objectId: string,
  objectName: string,
  animation: SceneScriptObjectAnimation | undefined
): ObjectAnimationTrack | null {
  if (!animation) return null;
  const requestedDuration = Number(animation.duration ?? 5);
  const duration = ([5, 10, 15] as const).reduce((nearest, candidate) =>
    Math.abs(candidate - requestedDuration) < Math.abs(nearest - requestedDuration) ? candidate : nearest
  );
  const playbackMode: ObjectAnimationPlaybackMode =
    animation.playbackMode === "camera-driven" || animation.playbackMode === "recording-sync"
      ? animation.playbackMode
      : "normal";
  return {
    id: animation.id?.trim() || `object_animation_${objectId}`,
    name: animation.name?.trim() || `${objectName}动画`,
    duration,
    loop: animation.loop !== false,
    enabled: animation.enabled !== false,
    playbackMode,
    cameraId: typeof animation.cameraId === "string" ? animation.cameraId : null,
    keyframes: Array.isArray(animation.keyframes) ? animation.keyframes : [],
    path:
      animation.path && Array.isArray(animation.path.points) && animation.path.points.length >= 2
        ? {
            type: animation.path.type === "linear" ? "linear" : "curve",
            closed: Boolean(animation.path.closed),
            orientToPath: Boolean(animation.path.orientToPath),
            points: animation.path.points.map((point) => toTuple3(point, [0, 0, 0])),
          }
        : undefined,
  };
}

export function validateScenePlan(value: unknown): { plan: ScenePlan; warnings: string[] } {
  if (!value || typeof value !== "object") throw new Error("ScenePlan 必须是对象");
  const raw = value as Partial<ScenePlan>;
  const intent = typeof raw.intent === "string" ? raw.intent.trim() : "";
  if (!intent) throw new Error("ScenePlan 缺少 intent");
  const roles = Array.isArray(raw.roles)
    ? raw.roles
        .filter((role): role is ScenePlan["roles"][number] => Boolean(role && typeof role.name === "string" && role.name.trim()))
        .map((role) => ({
          name: role.name.trim(),
          purpose: typeof role.purpose === "string" ? role.purpose.trim() : undefined,
          pose: typeof role.pose === "string" ? role.pose.trim() : undefined,
          relation: typeof role.relation === "string" ? role.relation.trim() : undefined,
        }))
    : [];
  if (roles.length === 0) throw new Error("ScenePlan 至少需要一个角色");
  const duplicateRoleNames = roles.map((role) => role.name).filter((name, index, values) => values.indexOf(name) !== index);
  return {
    plan: {
      intent,
      roles,
      composition: typeof raw.composition === "string" ? raw.composition.trim() : undefined,
      environment: typeof raw.environment === "string" ? raw.environment.trim() : undefined,
      assemblies: Array.isArray(raw.assemblies)
        ? raw.assemblies
            .filter((assembly) => assembly && typeof assembly.name === "string" && Array.isArray(assembly.parts))
            .map((assembly) => ({
              name: assembly.name.trim(),
              parts: assembly.parts.filter((part): part is string => typeof part === "string" && Boolean(part.trim())),
              motion: typeof assembly.motion === "string" ? assembly.motion.trim() : undefined,
            }))
        : undefined,
      reviewNotes: typeof raw.reviewNotes === "string" ? raw.reviewNotes.trim() : undefined,
    },
    warnings: duplicateRoleNames.length ? [`角色名称重复：${[...new Set(duplicateRoleNames)].join("、")}`] : [],
  };
}

function buildScenePlanReview(plan: ScenePlan) {
  const project = useDirectorStore.getState().project;
  const characterNames = new Set(project.objects.filter((object) => object.kind === "character").map((object) => object.name));
  const missingRoles = plan.roles.filter((role) => !characterNames.has(role.name)).map((role) => role.name);
  return {
    intent: plan.intent,
    missingRoles,
    characterCount: project.objects.filter((object) => object.kind === "character").length,
    propCount: project.objects.filter((object) => object.kind === "prop" || object.kind === "scene").length,
    groupCount: project.objects.filter((object) => object.kind === "group").length,
    animatedObjectCount: project.objects.filter((object) => object.objectAnimationTrack?.enabled).length,
    cameraCount: project.cameras.length,
    nextStep: missingRoles.length ? "补充缺失角色后再次截图检查构图" : "查看截图，按构图与道具关系提交修正命令",
  };
}

function buildAssemblyReview() {
  const objects = useDirectorStore
    .getState()
    .project.objects.filter((object) => object.kind === "prop" && object.geometryType);
  const potentialIntersections: Array<{ parentId: string | null; objects: [string, string] }> = [];
  for (let leftIndex = 0; leftIndex < objects.length; leftIndex += 1) {
    const left = objects[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < objects.length; rightIndex += 1) {
      const right = objects[rightIndex];
      if ((left.parentId ?? null) !== (right.parentId ?? null)) continue;
      const overlapAxes = left.transform.position.map((value, axis) => {
        const halfExtent = (Math.abs(left.transform.scale[axis]) + Math.abs(right.transform.scale[axis])) * 0.5;
        return halfExtent - Math.abs(value - right.transform.position[axis]);
      });
      const minimumScale = Math.min(
        ...left.transform.scale.map(Math.abs),
        ...right.transform.scale.map(Math.abs)
      );
      if (overlapAxes.every((overlap) => overlap > minimumScale * 0.35)) {
        potentialIntersections.push({ parentId: left.parentId ?? null, objects: [left.name, right.name] });
      }
    }
  }
  return {
    groupCount: useDirectorStore.getState().project.objects.filter((object) => object.kind === "group").length,
    animatedObjectCount: useDirectorStore.getState().project.objects.filter((object) => object.objectAnimationTrack?.enabled).length,
    potentialIntersections: potentialIntersections.slice(0, 20),
    reviewInstruction: "结合返回截图检查轮廓、比例和部件穿插；必要时用 update_prop 提交局部坐标修正。",
  };
}

async function captureScenePlanReview() {
  try {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
    });
    const captures = await requestViewportCapture({ preset: "current", source: "capture-panel" });
    return captures[0]?.dataUrl ?? null;
  } catch {
    // Scene creation must not fail merely because the viewport capture bridge is
    // still mounting after a cold start or a large asset import.
    return null;
  }
}

function findObject(idOrName: unknown, kind?: DirectorObject["kind"]) {
  if (typeof idOrName !== "string" || !idOrName.trim()) return null;
  const needle = idOrName.trim();
  return (
    useDirectorStore
      .getState()
      .project.objects.find((item) => (!kind || item.kind === kind) && (item.id === needle || item.name === needle)) ??
    null
  );
}

function getTransformPatch(
  input: {
    position?: number[];
    rotation?: number[];
    rotationY?: number;
    scale?: number | number[];
  },
  transform: DirectorTransform
): DirectorTransform {
  return {
    position: toTuple3(input.position, transform.position),
    rotation: normalizeRotation(input, transform.rotation),
    scale: toScaleTuple(input.scale, transform.scale),
  };
}

export function addCharacter(input: SceneScriptCharacter = {}) {
  const store = useDirectorStore.getState();
  const bodyType = normalizeBodyType(input.bodyType ?? input.type);
  store.addPresetCharacter(bodyType);

  const nextState = useDirectorStore.getState();
  const id = nextState.selectedObjectId;
  const character = id ? nextState.project.objects.find((item) => item.id === id && item.kind === "character") : null;
  if (!character) throw new Error("Character was not created");

  if (input.name) nextState.updateObjectName(character.id, input.name);
  if (typeof input.color === "string" && input.color.trim()) nextState.updateObjectColor(character.id, input.color.trim());
  nextState.updateObjectTransform(character.id, getTransformPatch(input, character.transform));

  const poseId = normalizePoseId(input.pose);
  if (poseId) nextState.applyPosePreset(character.id, poseId);
  const poseControls = normalizePoseControls(input.poseControls);
  if (poseControls) nextState.replacePoseControls(character.id, poseControls);
  if (input.asset?.fileName && input.asset.url) {
    useDirectorStore.getState().attachImportedAssetToCharacter(character.id, {
      kind: "character",
      name: input.asset.name?.trim() || input.name?.trim() || character.name,
      fileName: input.asset.fileName,
      url: input.asset.url,
      assetSource: input.asset.assetSource,
      animated: input.asset.animated,
    });
  }
  const motionClipId = importCharacterMotionClip(character.id, input.motionClip);
  applyCharacterAction(
    character.id,
    input.action ?? (motionClipId ? { id: "idle", source: "video", enabled: true } : undefined),
    motionClipId
  );

  return { id: character.id };
}

export function updateCharacter(input: SceneScriptCharacter & { id?: string; name?: string }) {
  const target = findObject(input.id ?? input.name, "character");
  if (!target) throw new Error("Character not found");

  const store = useDirectorStore.getState();
  if (input.name && input.name !== target.name) store.updateObjectName(target.id, input.name);
  if (typeof input.color === "string" && input.color.trim()) store.updateObjectColor(target.id, input.color.trim());
  if (input.bodyType || input.type) store.updateCharacterBodyType(target.id, normalizeBodyType(input.bodyType ?? input.type));
  store.updateObjectTransform(target.id, getTransformPatch(input, target.transform));

  const poseId = normalizePoseId(input.pose);
  if (poseId) store.applyPosePreset(target.id, poseId);
  const poseControls = normalizePoseControls(input.poseControls);
  if (poseControls) store.replacePoseControls(target.id, poseControls);
  const motionClipId = importCharacterMotionClip(target.id, input.motionClip);
  applyCharacterAction(
    target.id,
    input.action ?? (motionClipId ? { id: "idle", source: "video", enabled: true } : undefined),
    motionClipId
  );

  return { id: target.id };
}

export function addProp(input: SceneScriptProp = {}) {
  const preset = PROP_PRESETS[String(input.type ?? "").toLowerCase()];
  const geometryType = input.geometryType ?? preset?.geometryType ?? "box";
  const store = useDirectorStore.getState();
  store.addGeometryPrimitive(geometryType);

  const nextState = useDirectorStore.getState();
  const id = nextState.selectedObjectId;
  const prop = id ? nextState.project.objects.find((item) => item.id === id && item.kind === "prop") : null;
  if (!prop) throw new Error("Prop was not created");

  nextState.updateObjectName(prop.id, input.name ?? preset?.name ?? prop.name);
  if (input.color ?? preset?.color) nextState.updateObjectColor(prop.id, input.color ?? preset?.color ?? prop.color ?? "#d7e7ff");
  if (input.material) nextState.updateObjectMaterial(prop.id, input.material);
  if (input.geometryAnchor) nextState.updateObjectGeometryAnchor(prop.id, input.geometryAnchor);
  if (input.geometrySize) nextState.updateObjectGeometrySize(prop.id, toScaleTuple(input.geometrySize, [1, 1, 1]));
  nextState.updateObjectTransform(prop.id, {
    position: toTuple3(input.position, prop.transform.position),
    rotation: normalizeRotation(input, prop.transform.rotation),
    scale: toScaleTuple(input.scale, preset?.scale ?? prop.transform.scale),
  });
  if (input.parentId) nextState.setObjectParent(prop.id, input.parentId);
  if (input.pivot) nextState.updateObjectPivot(prop.id, toTuple3(input.pivot, [0, 0, 0]));
  const animation = normalizeObjectAnimation(prop.id, input.name ?? preset?.name ?? prop.name, input.animation);
  if (animation) nextState.setObjectAnimationTrack(prop.id, animation);

  return { id: prop.id };
}

export function addGroup(input: SceneScriptGroup = {}) {
  const transform: DirectorTransform = {
    position: toTuple3(input.position, [0, 0, 0]),
    rotation: normalizeRotation(input, [0, 0, 0]),
    scale: toScaleTuple(input.scale, [1, 1, 1]),
  };
  const id = useDirectorStore.getState().addGroup({
    name: input.name,
    parentId: input.parentId ?? null,
    pivot: toTuple3(input.pivot, [0, 0, 0]),
    transform,
    assemblySelectionMode: input.selectionMode,
  });
  const animation = normalizeObjectAnimation(id, input.name ?? "组合", input.animation);
  if (animation) useDirectorStore.getState().setObjectAnimationTrack(id, animation);
  return { id };
}

export function updateProp(input: SceneScriptProp & { id?: string; name?: string; delete?: boolean }) {
  const target = findObject(input.id ?? input.name);
  if (!target || (target.kind !== "prop" && target.kind !== "group" && target.kind !== "scene")) throw new Error("Prop not found");

  const store = useDirectorStore.getState();
  if (input.name && input.name !== target.name) store.updateObjectName(target.id, input.name);
  if (input.color) store.updateObjectColor(target.id, input.color);
  if (input.material) store.updateObjectMaterial(target.id, input.material);
  if (input.geometryAnchor) store.updateObjectGeometryAnchor(target.id, input.geometryAnchor);
  if (input.geometrySize) store.updateObjectGeometrySize(target.id, toScaleTuple(input.geometrySize, target.geometrySize ?? [1, 1, 1]));
  store.updateObjectTransform(target.id, getTransformPatch(input, target.transform));
  if (input.parentId !== undefined) store.setObjectParent(target.id, input.parentId);
  if (input.pivot) store.updateObjectPivot(target.id, toTuple3(input.pivot, target.pivot ?? [0, 0, 0]));
  const animation = normalizeObjectAnimation(target.id, input.name ?? target.name, input.animation);
  if (animation) store.setObjectAnimationTrack(target.id, animation);

  return { id: target.id };
}

function cameraSnapshotFromInput(input: SceneScriptCamera = {}): CameraShotSnapshot {
  const position = toTuple3(input.position, [0, 1.6, 5]);
  return {
    fov: typeof input.fov === "number" && Number.isFinite(input.fov) ? input.fov : 35,
    position,
    target: toTuple3(input.lookAt ?? input.target, [0, 1.2, 0]),
  };
}

export function addCamera(input: SceneScriptCamera = {}) {
  const store = useDirectorStore.getState();
  const id = store.addCameraShot(cameraSnapshotFromInput(input));
  if (input.name) useDirectorStore.getState().updateCamera(id, { name: input.name });
  return { id };
}

export function setCameraView(input: SceneScriptCamera = {}) {
  const store = useDirectorStore.getState();
  let cameraId = typeof input.id === "string" ? input.id : store.project.activeCameraId;
  if (!cameraId || !store.project.cameras.some((camera) => camera.id === cameraId)) {
    cameraId = store.addCameraShot(cameraSnapshotFromInput(input));
  }

  const snapshot = cameraSnapshotFromInput({
    ...input,
    position: input.position ?? store.project.cameras.find((camera) => camera.id === cameraId)?.transform.position,
  });
  const transform: DirectorTransform = {
    position: getCameraRigPositionFromViewSnapshot(snapshot),
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };
  useDirectorStore.getState().updateCamera(cameraId, {
    fov: snapshot.fov,
    targetMode: "manual",
    targetObjectId: null,
    target: snapshot.target,
    transform,
  });
  useDirectorStore.getState().setActiveCamera(cameraId);
  return { id: cameraId };
}

function samplePolyline(points: NumberTuple3[], progress: number): NumberTuple3 {
  if (points.length < 2) return points[0] ?? [0, 0, 0];
  const scaled = Math.min(Math.max(progress, 0), 1) * (points.length - 1);
  const index = Math.min(Math.floor(scaled), points.length - 2);
  const local = scaled - index;
  return points[index].map((value, axis) =>
    Number((value + (points[index + 1][axis] - value) * local).toFixed(4))
  ) as NumberTuple3;
}

function expandPropCopies(input: SceneScriptProp) {
  const basePosition = toTuple3(input.position, [0, 0, 0]);
  const baseRotation = normalizeRotation(input, [0, 0, 0]);
  const baseScale = toScaleTuple(input.scale, [1, 1, 1]);
  let copies: SceneScriptProp[] = [{ ...input, position: basePosition, rotation: baseRotation, scale: baseScale }];

  if (input.repeat?.count && input.repeat.count > 1) {
    const count = Math.min(Math.max(Math.round(input.repeat.count), 1), 200);
    const offset = toTuple3(input.repeat.offset, [1, 0, 0]);
    const rotationStep = toTuple3(input.repeat.rotationStep, [0, 0, 0]);
    const scaleStep = toTuple3(input.repeat.scaleStep, [0, 0, 0]);
    copies = Array.from({ length: count }, (_, index) => ({
      ...input,
      id: input.id ? `${input.id}_${index + 1}` : undefined,
      name: count > 1 ? `${input.name ?? input.type ?? "部件"}${String(index + 1).padStart(2, "0")}` : input.name,
      position: basePosition.map((value, axis) => value + offset[axis] * index),
      rotation: baseRotation.map((value, axis) => value + rotationStep[axis] * index),
      scale: baseScale.map((value, axis) => value + scaleStep[axis] * index),
      repeat: undefined,
    }));
  }

  if (input.pathCopy?.points?.length && input.pathCopy.count > 1) {
    const points = input.pathCopy.points.map((point) => toTuple3(point, [0, 0, 0]));
    const count = Math.min(Math.max(Math.round(input.pathCopy.count), 2), 200);
    copies = Array.from({ length: count }, (_, index) => {
      const position = samplePolyline(points, index / (count - 1));
      const nextPosition = samplePolyline(points, Math.min((index + 0.01) / (count - 1), 1));
      const rotation = [...baseRotation] as NumberTuple3;
      if (input.pathCopy?.orientToPath) {
        rotation[1] = Math.atan2(nextPosition[0] - position[0], nextPosition[2] - position[2]);
      }
      return {
        ...input,
        id: input.id ? `${input.id}_${index + 1}` : undefined,
        name: `${input.name ?? input.type ?? "路径部件"}${String(index + 1).padStart(2, "0")}`,
        position,
        rotation,
        scale: baseScale,
        pathCopy: undefined,
      };
    });
  }

  if (input.mirror) {
    const axes = Array.isArray(input.mirror.axis) ? input.mirror.axis : [input.mirror.axis];
    const mirrored = copies.map((copy) => {
      const position = toTuple3(copy.position, basePosition);
      const rotation = normalizeRotation(copy, baseRotation);
      const scale = toScaleTuple(copy.scale, baseScale);
      axes.forEach((axis) => {
        const axisIndex = axis === "x" ? 0 : axis === "y" ? 1 : 2;
        position[axisIndex] *= -1;
        scale[axisIndex] *= -1;
        rotation[(axisIndex + 1) % 3] *= -1;
        rotation[(axisIndex + 2) % 3] *= -1;
      });
      const animation = copy.animation
        ? {
            ...copy.animation,
            keyframes: copy.animation.keyframes?.map((keyframe) => {
              if (!keyframe.rotation) return keyframe;
              const mirroredRotation = [...keyframe.rotation] as NumberTuple3;
              axes.forEach((axis) => {
                const axisIndex = axis === "x" ? 0 : axis === "y" ? 1 : 2;
                mirroredRotation[(axisIndex + 1) % 3] *= -1;
                mirroredRotation[(axisIndex + 2) % 3] *= -1;
              });
              return { ...keyframe, rotation: mirroredRotation };
            }),
          }
        : undefined;
      return {
        ...copy,
        id: copy.id ? `${copy.id}_mirror` : undefined,
        name: `${copy.name ?? input.name ?? "部件"}镜像`,
        position,
        rotation,
        scale,
        animation,
        mirror: undefined,
      };
    });
    copies = [...copies, ...mirrored];
  }

  return copies;
}

function isSceneScriptGroup(value: SceneScriptGroup | SceneScriptProp): value is SceneScriptGroup {
  return (value as SceneScriptGroup).kind === "group";
}

export function applySceneScript(script: SceneScript = {}) {
  const store = useDirectorStore.getState();
  store.beginUndoBatch();
  try {
  const scenePlan = script.scenePlan ? validateScenePlan(script.scenePlan).plan : null;
  const proceduralConversions = (script.proceduralObjects ?? []).map(convertObjectSculptSpecToSceneScript);
  const proceduralGroups = proceduralConversions.flatMap((conversion) => conversion.script.groups ?? []);
  const proceduralWarnings = proceduralConversions.flatMap((conversion) => conversion.warnings);
  if (script.reset) {
    const project = createDefaultDirectorProject({ includePersistedLocalAssets: true });
    useDirectorStore.getState().replaceProject({
      ...project,
      assets: project.assets.filter((asset) => asset.kind !== "panorama"),
      objects: [],
      cameras: [],
      cameraAnimations: [],
      activeCameraId: null,
      panoramaAssetId: null,
    });
  }

  if (script.scene) useDirectorStore.getState().updateScene(script.scene);
  if (script.panorama?.url) {
    useDirectorStore.getState().addImportedAsset({
      kind: "panorama",
      name: script.panorama.name ?? "全景背景",
      fileName: script.panorama.fileName ?? "panorama.jpg",
      url: script.panorama.url,
      projectionMode: script.panorama.projectionMode ?? "equirectangular",
    });
  } else if (script.panorama === null) {
    useDirectorStore.getState().removePanoramaAsset();
  }

  const objectIdMap = new Map<string, string>();
  const characterIds = (script.characters ?? []).map((character) => {
    const id = addCharacter(character).id;
    if (character.id) objectIdMap.set(character.id, id);
    return id;
  });
  const groupIds: string[] = [];
  const propIds: string[] = [];
  const createPart = (
    part: SceneScriptGroup | SceneScriptProp,
    inheritedParentId: string | null = null,
    inheritedAssemblyRootId: string | null = null
  ) => {
    const requestedParentId = part.parentId ? objectIdMap.get(part.parentId) ?? part.parentId : inheritedParentId;
    if (isSceneScriptGroup(part)) {
      const id = addGroup({ ...part, parentId: requestedParentId }).id;
      groupIds.push(id);
      if (part.id) objectIdMap.set(part.id, id);
      const assemblyRootId = part.selectionMode === "whole" ? id : inheritedAssemblyRootId;
      if (assemblyRootId) {
        useDirectorStore.getState().setObjectAssemblyMetadata(id, {
          assemblyRootId,
          assemblySelectionMode: part.selectionMode,
        });
      }
      (part.children ?? []).forEach((child) => createPart(child, id, assemblyRootId));
      return;
    }
    expandPropCopies({ ...part, parentId: requestedParentId }).forEach((copy) => {
      const id = addProp(copy).id;
      propIds.push(id);
      if (copy.id) objectIdMap.set(copy.id, id);
      if (inheritedAssemblyRootId) {
        useDirectorStore.getState().setObjectAssemblyMetadata(id, { assemblyRootId: inheritedAssemblyRootId });
      }
      (part.children ?? []).forEach((child) => createPart(child, id, inheritedAssemblyRootId));
    });
  };
  [...(script.groups ?? []), ...proceduralGroups].forEach((group) => createPart({ ...group, kind: "group" }));
  (script.props ?? []).forEach((prop) => createPart(prop));
  const requestedCameras = [...(script.camera ? [script.camera] : []), ...(script.cameras ?? [])];
  const cameraIdMap = new Map<string, string>();
  const cameraIds = requestedCameras.map((camera) => {
    const id = addCamera(camera).id;
    if (camera.id) cameraIdMap.set(camera.id, id);
    return id;
  });
  cameraIdMap.forEach((value, key) => objectIdMap.set(key, value));
  if (script.cameraAnimations) {
    useDirectorStore.getState().replaceCameraAnimations(
      script.cameraAnimations.map((animation) => ({
        ...animation,
        cameraId: cameraIdMap.get(animation.cameraId) ?? animation.cameraId,
      }))
    );
  }
  const activeCameraId = script.activeCameraId ? cameraIdMap.get(script.activeCameraId) ?? script.activeCameraId : null;
  if (activeCameraId && useDirectorStore.getState().project.cameras.some((camera) => camera.id === activeCameraId)) {
    useDirectorStore.getState().setActiveCamera(activeCameraId);
  }
  const animationSequenceReviews = (script.animationSequences ?? []).map((sequence) =>
    importAnimationSequencePackage(sequence, objectIdMap)
  );
  if (script.directorView && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("storyai:director-view", {
      detail: cameraSnapshotFromInput(script.directorView),
    }));
  }
  if (scenePlan) useDirectorStore.getState().setScenePlan(scenePlan);
  syncImportedNormalCharacterAnimations();

  return {
    characterIds,
    groupIds,
    propIds,
    cameraIds,
    scenePlan: scenePlan ? buildScenePlanReview(scenePlan) : null,
    structureReview: buildAssemblyReview(),
    proceduralWarnings,
    animationSequenceReviews,
  };
  } finally {
    useDirectorStore.getState().endUndoBatch();
  }
}

export function exportSceneScript(): SceneScript {
  const project = useDirectorStore.getState().project;
  const panoramaAsset = project.assets.find((asset) => asset.id === project.panoramaAssetId && asset.kind === "panorama");
  const characters: SceneScriptCharacter[] = project.objects
    .filter((object) => object.kind === "character")
    .map((object) => {
      const asset = object.assetRefId ? project.assets.find((candidate) => candidate.id === object.assetRefId) : undefined;
      const motionClip = object.characterActionTrack?.motionClipId
        ? (project.characterMotionClips ?? []).find((clip) => clip.id === object.characterActionTrack?.motionClipId)
        : undefined;
      return {
        id: object.id,
        name: object.name,
        bodyType: object.bodyType,
        color: object.color,
        rigType: object.characterRig?.rigType,
        pose: object.characterRig?.posePresetId ?? undefined,
        poseControls: object.characterRig?.controls,
        position: object.transform.position,
        rotation: object.transform.rotation,
        scale: object.transform.scale,
        action: object.characterActionTrack
          ? {
              id: object.characterActionTrack.actionId,
              duration: object.characterActionTrack.duration,
              playbackMode: object.characterActionTrack.playbackMode,
              cameraId: object.characterActionTrack.cameraId,
              enabled: object.characterActionTrack.enabled,
              source: object.characterActionTrack.source,
              motionClipId: object.characterActionTrack.motionClipId,
            }
          : undefined,
        motionClip: motionClip
          ? { name: motionClip.name, duration: motionClip.duration, frames: motionClip.frames }
          : undefined,
        asset: asset?.sourceType === "model"
          ? {
              name: asset.name,
              fileName: asset.fileName,
              url: asset.url,
              assetSource: asset.assetSource,
              animated: asset.animated,
            }
          : undefined,
      };
    });
  const childrenByParentId = new Map<string, DirectorObject[]>();
  project.objects.forEach((object) => {
    if (!object.parentId) return;
    const children = childrenByParentId.get(object.parentId) ?? [];
    children.push(object);
    childrenByParentId.set(object.parentId, children);
  });
  const animationFromObject = (object: DirectorObject): SceneScriptObjectAnimation | undefined =>
    object.objectAnimationTrack
      ? {
          id: object.objectAnimationTrack.id,
          name: object.objectAnimationTrack.name,
          duration: object.objectAnimationTrack.duration,
          loop: object.objectAnimationTrack.loop,
          enabled: object.objectAnimationTrack.enabled,
          playbackMode: object.objectAnimationTrack.playbackMode,
          cameraId: object.objectAnimationTrack.cameraId,
          keyframes: object.objectAnimationTrack.keyframes,
          path: object.objectAnimationTrack.path,
        }
      : undefined;
  const toScenePart = (object: DirectorObject): SceneScriptGroup | SceneScriptProp => {
    const children = (childrenByParentId.get(object.id) ?? [])
      .filter((child) => child.kind === "group" || child.kind === "prop" || child.kind === "scene")
      .map(toScenePart);
    if (object.kind === "group") {
      return {
        kind: "group",
        id: object.id,
        name: object.name,
        position: object.transform.position,
        rotation: object.transform.rotation,
        scale: object.transform.scale,
        pivot: object.pivot,
        selectionMode: object.assemblySelectionMode,
        animation: animationFromObject(object),
        children,
      };
    }
    return {
      id: object.id,
      name: object.name,
      geometryType: object.geometryType ?? "box",
      position: object.transform.position,
      rotation: object.transform.rotation,
      scale: object.transform.scale,
      pivot: object.pivot,
      color: object.color,
      geometryAnchor: object.geometryAnchor,
      geometrySize: object.geometrySize,
      material: object.material,
      animation: animationFromObject(object),
      children,
    };
  };
  const topLevelParts = project.objects
    .filter(
      (object) =>
        !object.parentId && (object.kind === "group" || object.kind === "prop" || object.kind === "scene")
    )
    .map(toScenePart);
  const groups = topLevelParts.filter((part): part is SceneScriptGroup => isSceneScriptGroup(part));
  const props = topLevelParts.filter((part): part is SceneScriptProp => !isSceneScriptGroup(part));
  const cameras: SceneScriptCamera[] = project.cameras.map((camera) => {
    const snapshot = getCameraViewSnapshotFromShot(camera);
    return {
      id: camera.id,
      name: camera.name,
      position: snapshot.position,
      lookAt: snapshot.target,
      fov: snapshot.fov,
    };
  });

  return {
    reset: true,
    scene: project.scene,
    characters,
    groups,
    props,
    cameras,
    activeCameraId: project.activeCameraId,
    cameraAnimations: project.cameraAnimations,
    animationSequences: (project.animationSequences ?? []).map((sequence) => exportAnimationSequencePackage(sequence.id)),
    panorama: panoramaAsset
      ? {
          name: panoramaAsset.name,
          fileName: panoramaAsset.fileName,
          url: panoramaAsset.url,
          projectionMode: panoramaAsset.projectionMode,
        }
      : null,
    scenePlan: project.scenePlan ?? null,
  };
}

export function exportCharacterPackage(characterId: string): CharacterPackage {
  const character = exportSceneScript().characters?.find((item) => item.id === characterId);
  if (!character) throw new Error("Character not found");
  return {
    format: "storyai-character",
    version: 1,
    character,
  };
}

function unwrapAnimationSequencePackage(
  value: DirectorAnimationSequence | AnimationSequencePackage
): { sequence: DirectorAnimationSequence; motionClips: AnimationSequenceMotionClipInput[] } {
  if ("format" in value && value.format === "storyai-animation-sequence") {
    return { sequence: value.sequence, motionClips: value.motionClips ?? [] };
  }
  return { sequence: value as DirectorAnimationSequence, motionClips: [] };
}

function resolveAnimationSequence(
  value: DirectorAnimationSequence | AnimationSequencePackage,
  authoredIdMap: Map<string, string> = new Map()
) {
  const { sequence, motionClips } = unwrapAnimationSequencePackage(value);
  if (!sequence || typeof sequence !== "object" || !Array.isArray(sequence.bindings) || !Array.isArray(sequence.tracks)) {
    throw new Error("动画命令缺少 sequence、bindings 或 tracks");
  }
  const objects = useDirectorStore.getState().project.objects;
  const bindings = sequence.bindings.map((binding) => {
    const mappedId = authoredIdMap.get(binding.objectId) ?? binding.objectId;
    const byId = objects.find((object) => object.id === mappedId);
    if (byId) return { ...binding, objectId: byId.id, objectName: byId.name };
    const matches = objects.filter((object) => object.name === binding.objectName || object.name === binding.alias);
    if (matches.length > 1) throw new Error(`动画绑定“${binding.alias}”匹配到多个同名对象`);
    if (!matches.length) throw new Error(`动画绑定“${binding.alias}”找不到对象 ${binding.objectName || binding.objectId}`);
    return { ...binding, objectId: matches[0].id, objectName: matches[0].name };
  });
  const bindingByAlias = new Map(bindings.map((binding) => [binding.alias, binding]));
  sequence.tracks.forEach((track) => {
    if (!bindingByAlias.has(track.binding)) throw new Error(`轨道“${track.name}”引用了未定义绑定 ${track.binding}`);
  });

  const clipIdMap = new Map<string, string>();
  motionClips.forEach((clip) => {
    const binding = bindingByAlias.get(clip.binding);
    if (!binding) throw new Error(`动作片段“${clip.name}”引用了未定义绑定 ${clip.binding}`);
    const id = useDirectorStore.getState().addCharacterMotionClip({
      characterId: binding.objectId,
      name: clip.name,
      duration: clip.duration,
      frames: clip.frames,
    });
    clipIdMap.set(clip.id, id);
  });

  return {
    ...sequence,
    cameraId: sequence.cameraId ? authoredIdMap.get(sequence.cameraId) ?? sequence.cameraId : null,
    bindings,
    tracks: sequence.tracks.map((track) =>
      track.type === "character" && track.motionClipId && clipIdMap.has(track.motionClipId)
        ? { ...track, motionClipId: clipIdMap.get(track.motionClipId)! }
        : track
    ),
  };
}

export function importAnimationSequencePackage(
  value: DirectorAnimationSequence | AnimationSequencePackage,
  authoredIdMap: Map<string, string> = new Map()
) {
  const store = useDirectorStore.getState();
  store.beginUndoBatch();
  try {
    const sequence = resolveAnimationSequence(value, authoredIdMap);
    const existing = useDirectorStore.getState().project.animationSequences?.some((item) => item.id === sequence.id);
    const sequenceId = existing
      ? sequence.id
      : useDirectorStore.getState().addAnimationSequence(sequence);
    if (existing) useDirectorStore.getState().updateAnimationSequence(sequenceId, sequence);
    useDirectorStore.getState().setActiveAnimationSequence(sequenceId);
    const importedSequence = useDirectorStore.getState().project.animationSequences?.find((item) => item.id === sequenceId);
    if (!importedSequence) throw new Error("动画序列未能写入工程");
    if (importedSequence.playbackMode === "manual") {
      playAnimationSequence(importedSequence, { reset: true });
    } else {
      scrubAnimationSequence(importedSequence, 0);
    }
    return {
      ...reviewAnimationSequence(sequenceId),
      autoPlaying: importedSequence.playbackMode === "manual" && importedSequence.enabled,
    };
  } finally {
    useDirectorStore.getState().endUndoBatch();
  }
}

export function exportAnimationSequencePackage(sequenceId?: string): AnimationSequencePackage {
  const project = useDirectorStore.getState().project;
  const sequence = (project.animationSequences ?? []).find((item) => item.id === (sequenceId ?? project.activeAnimationSequenceId));
  if (!sequence) throw new Error("找不到动画序列");
  const motionClips = sequence.tracks.flatMap((track) => {
    if (track.type !== "character" || !track.motionClipId) return [];
    const clip = (project.characterMotionClips ?? []).find((item) => item.id === track.motionClipId);
    if (!clip) return [];
    return [{
      id: clip.id,
      binding: track.binding,
      name: clip.name,
      duration: clip.duration,
      frames: clip.frames,
    }];
  });
  return { format: "storyai-animation-sequence", version: 1, sequence, motionClips };
}

export function reviewAnimationSequence(sequenceId?: string) {
  const project = useDirectorStore.getState().project;
  const sequence = (project.animationSequences ?? []).find((item) => item.id === (sequenceId ?? project.activeAnimationSequenceId));
  if (!sequence) throw new Error("找不到动画序列");
  const warnings: string[] = [];
  const aliases = new Set(sequence.bindings.map((binding) => binding.alias));
  sequence.bindings.forEach((binding) => {
    if (!project.objects.some((object) => object.id === binding.objectId)) warnings.push(`绑定 ${binding.alias} 的对象已不存在`);
  });
  sequence.tracks.forEach((track) => {
    if (!aliases.has(track.binding)) warnings.push(`轨道 ${track.name} 缺少绑定`);
    if (track.startTime < 0 || track.endTime > sequence.duration || track.endTime <= track.startTime) {
      warnings.push(`轨道 ${track.name} 的时间范围无效`);
    }
    if (track.type === "object") {
      const ordered = [...track.keyframes].sort((left, right) => left.time - right.time);
      ordered.slice(1).forEach((frame, index) => {
        const previous = ordered[index];
        if (!frame.position || !previous.position) return;
        if (Math.hypot(...frame.position.map((value, axis) => value - previous.position![axis])) > 30) {
          warnings.push(`轨道 ${track.name} 存在超过 30 米的突然位移`);
        }
      });
    }
  });
  return {
    id: sequence.id,
    name: sequence.name,
    duration: sequence.duration,
    playbackMode: sequence.playbackMode,
    loop: sequence.loop,
    bindingCount: sequence.bindings.length,
    trackCount: sequence.tracks.length,
    characterTrackCount: sequence.tracks.filter((track) => track.type === "character").length,
    objectTrackCount: sequence.tracks.filter((track) => track.type === "object").length,
    warnings,
  };
}

export function importCharacterPackage(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Invalid character JSON");
  const candidate = value as Partial<CharacterPackage> & SceneScriptCharacter;
  const character = candidate.format === "storyai-character" ? candidate.character : candidate;
  if (!character || typeof character !== "object") throw new Error("Character JSON is missing character data");
  return addCharacter(character);
}

export function deleteObject(input: { id?: string; name?: string }) {
  const target = findObject(input.id ?? input.name);
  if (!target) throw new Error("Object not found");
  useDirectorStore.getState().selectObject(target.id);
  useDirectorStore.getState().deleteSelectedObject();
  return { id: target.id };
}

export async function executeDirectorAgentTool(tool: string, args: unknown = {}): Promise<AgentToolResult> {
  switch (tool) {
    case "get_scene":
      return {
        selectedObjectId: useDirectorStore.getState().selectedObjectId,
        project: useDirectorStore.getState().project,
      };
    case "reset_scene":
      useDirectorStore.getState().replaceProject(createDefaultDirectorProject({ includePersistedLocalAssets: true }));
      return { ok: true };
    case "apply_scene_script":
    case "import_scene_script": {
      const result = applySceneScript(args as SceneScript);
      return { ...result, screenshot: await captureScenePlanReview() };
    }
    case "import_object_sculpt_spec": {
      if (!isObjectSculptSpec(args)) throw new Error("不是有效的 ObjectSculptSpec：需要 targetName、componentTree 和 materials");
      const converted = convertObjectSculptSpecToSceneScript(args);
      const result = applySceneScript(converted.script);
      return { ...result, warnings: converted.warnings, targetName: args.targetName, screenshot: await captureScenePlanReview() };
    }
    case "create_animation_sequence":
    case "import_animation_sequence":
      return importAnimationSequencePackage(args as DirectorAnimationSequence | AnimationSequencePackage);
    case "update_animation_sequence": {
      const input = args as { id?: string; patch?: Partial<DirectorAnimationSequence> } & Partial<DirectorAnimationSequence>;
      const id = input.id ?? useDirectorStore.getState().project.activeAnimationSequenceId;
      if (!id) throw new Error("找不到要更新的动画序列");
      useDirectorStore.getState().updateAnimationSequence(id, input.patch ?? input);
      return reviewAnimationSequence(id);
    }
    case "delete_animation_sequence": {
      const id = (args as { id?: string }).id ?? useDirectorStore.getState().project.activeAnimationSequenceId;
      if (!id) throw new Error("找不到要删除的动画序列");
      pauseAnimationSequence();
      useDirectorStore.getState().deleteAnimationSequence(id);
      return { id };
    }
    case "play_animation_sequence": {
      const id = (args as { id?: string }).id ?? useDirectorStore.getState().project.activeAnimationSequenceId;
      const sequence = useDirectorStore.getState().project.animationSequences?.find((item) => item.id === id);
      if (!sequence) throw new Error("找不到要播放的动画序列");
      useDirectorStore.getState().setActiveAnimationSequence(sequence.id);
      playAnimationSequence(sequence, { reset: (args as { reset?: boolean }).reset !== false });
      return reviewAnimationSequence(sequence.id);
    }
    case "pause_animation_sequence":
      pauseAnimationSequence();
      return { ok: true };
    case "scrub_animation_sequence": {
      const input = args as { id?: string; time?: number };
      const id = input.id ?? useDirectorStore.getState().project.activeAnimationSequenceId;
      const sequence = useDirectorStore.getState().project.animationSequences?.find((item) => item.id === id);
      if (!sequence) throw new Error("找不到要定位的动画序列");
      useDirectorStore.getState().setActiveAnimationSequence(sequence.id);
      scrubAnimationSequence(sequence, Number(input.time ?? 0));
      return { id: sequence.id, time: Math.min(sequence.duration, Math.max(0, Number(input.time ?? 0))) };
    }
    case "export_animation_sequence":
      return { animationPackage: exportAnimationSequencePackage((args as { id?: string }).id) };
    case "review_animation_sequence":
      return {
        ...reviewAnimationSequence((args as { id?: string }).id),
        screenshot: await captureScenePlanReview(),
      };
    case "validate_scene_plan": {
      const { plan, warnings } = validateScenePlan(args);
      return { plan, warnings, review: buildScenePlanReview(plan) };
    }
    case "apply_scene_plan": {
      const input = args as { plan?: ScenePlan; script?: SceneScript };
      const { plan, warnings } = validateScenePlan(input.plan);
      const result = applySceneScript({ ...(input.script ?? {}), scenePlan: plan });
      return { ...result, warnings, screenshot: await captureScenePlanReview() };
    }
    case "get_scene_plan":
      return { scenePlan: useDirectorStore.getState().project.scenePlan ?? null };
    case "export_scene_script":
      return { script: exportSceneScript() };
    case "export_character": {
      const input = args as { id?: string; name?: string };
      const target = findObject(input.id ?? input.name, "character");
      if (!target) throw new Error("Character not found");
      return { characterPackage: exportCharacterPackage(target.id) };
    }
    case "import_character":
      return importCharacterPackage(args);
    case "delete_object":
      return deleteObject(args as { id?: string; name?: string });
    case "add_character":
      return addCharacter(args as SceneScriptCharacter);
    case "update_character":
      return updateCharacter(args as SceneScriptCharacter);
    case "add_prop":
      return addProp(args as SceneScriptProp);
    case "add_group":
      return addGroup(args as SceneScriptGroup);
    case "update_prop":
      return updateProp(args as SceneScriptProp);
    case "add_camera":
      return addCamera(args as SceneScriptCamera);
    case "set_camera_view":
      return setCameraView(args as SceneScriptCamera);
    case "capture_shot": {
      const results = await requestViewportCapture({ preset: "current", source: "camera-panel" });
      useDirectorStore.getState().addCameraCaptures(useDirectorStore.getState().project.activeCameraId, results.map((item) => item.dataUrl));
      return { captures: results.length };
    }
    case "export_project":
      return { json: serializeProject(useDirectorStore.getState().project) };
    case "record_camera_animation": {
      const input = args as {
        cameraId?: string;
        name?: string;
        keyframes?: DirectorCameraAnimation["keyframes"];
      };
      const cameraId = input.cameraId ?? useDirectorStore.getState().project.activeCameraId;
      if (!cameraId) throw new Error("Missing cameraId");
      const id = useDirectorStore.getState().addCameraAnimation({
        cameraId,
        name: input.name,
        keyframes: input.keyframes ?? [],
      });
      return { id };
    }
    case "play_camera_animation": {
      const animationId = (args as { id?: string; name?: string }).id;
      const animationName = (args as { id?: string; name?: string }).name;
      const animation = useDirectorStore
        .getState()
        .project.cameraAnimations.find((item) => item.id === animationId || item.name === animationName);
      if (!animation) throw new Error("Camera animation not found");
      playCameraAnimation(animation);
      return { id: animation.id };
    }
    case "screenshot": {
      const results = await requestViewportCapture({ preset: "current", source: "capture-panel" });
      return { dataUrl: results[0]?.dataUrl ?? null, meta: results[0]?.meta ?? null };
    }
    default:
      throw new Error(`Unknown director tool: ${tool}`);
  }
}

export function startAgentCommandPolling() {
  let stopped = false;

  async function poll() {
    if (stopped) return;
    try {
      const response = await fetch("/api/agent/next", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as {
        command?: { id: string; tool: string; args?: unknown } | null;
      };
      if (!payload.command) return;

      try {
        const result = await executeDirectorAgentTool(payload.command.tool, payload.command.args ?? {});
        await fetch("/api/agent/result", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: payload.command.id, result }),
        });
      } catch (error) {
        await fetch("/api/agent/result", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: payload.command.id,
            error: error instanceof Error ? error.message : "Command failed",
          }),
        });
      }
    } catch {
      // The API exists only when the local dev server is running.
    }
  }

  const interval = window.setInterval(() => void poll(), 250);
  void poll();

  return () => {
    stopped = true;
    window.clearInterval(interval);
  };
}
