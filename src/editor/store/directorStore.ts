import { create } from "zustand";
import { MANNEQUIN_POSE_PRESETS } from "../presets/mannequinPosePresets";
import { GEOMETRY_PRIMITIVE_OPTIONS } from "../schema/directorProject";
import type {
  DirectorAssetRef,
  DirectorAssetSource,
  CharacterBodyType,
  CharacterActionTrack,
  CharacterMotionClip,
  DirectorAssetKind,
  DirectorCameraAnimation,
  DirectorCameraAnimationKeyframe,
  DirectorCameraCapture,
  DirectorCameraShot,
  DirectorAnimationSequence,
  DirectorObject,
  DirectorMaterialSettings,
  DirectorProject,
  DirectorTransform,
  GeometryPrimitiveType,
  ObjectAnimationTrack,
  PanoramaProjectionMode,
  SceneSettings,
  ScenePlan,
  ViewMode,
} from "../schema/directorProject";
import type { PosePresetId } from "../schema/poseSchema";
import { getDirectorObjectFocusTarget } from "../schema/cameraTarget";
import { DEFAULT_CHARACTER_BODY_TYPE, normalizeBodyType } from "../runtime/mannequin/bodyTypes";
import {
  DEFAULT_DIRECTOR_CAMERA_VIEW_SNAPSHOT,
  getCameraRigPositionFromViewSnapshot,
} from "../schema/cameraGeometry";
import type { ViewportAspectRatio } from "../schema/viewportAspectRatio";
import { resetObjectAnimationRuntime } from "../animation/objectAnimation";
import { resetAnimationSequenceRuntime } from "../animation/animationSequence";

export type TransformMode = "translate" | "rotate" | "scale";

export interface ImportedAssetInput {
  kind: DirectorAssetKind;
  name: string;
  fileName: string;
  url: string;
  addToScene?: boolean;
  assetSource?: DirectorAssetSource;
  projectionMode?: PanoramaProjectionMode;
  animated?: boolean;
}

export interface CameraShotSnapshot {
  fov: number;
  position: [number, number, number];
  target: [number, number, number];
}

export interface CrowdCharactersInput {
  bodyType?: CharacterBodyType;
  rows: number;
  columns: number;
  spacing: number;
}

function withoutMediaPoseControls(controls: Record<string, number>) {
  return Object.fromEntries(Object.entries(controls).filter(([key]) => !key.startsWith("mediaPose.")));
}

export interface DirectorStateOptions {
  includePersistedLocalAssets?: boolean;
  includePersistedScene?: boolean;
  persistenceScopeId?: string | null;
}

export interface DirectorUiState {
  viewMode: ViewMode;
  selectedObjectId: string | null;
  selectedObjectIds: string[];
  selectedCrowdId: string | null;
  directorInspectorMode: "auto" | "scene";
  transformMode: TransformMode;
  viewportAspectRatio: ViewportAspectRatio;
  viewportRuleOfThirdsEnabled: boolean;
  viewportPanelsCollapsed: boolean;
  cameraMonitorCollapsed: boolean;
  poseEditMode: boolean;
}

export interface DirectorState extends DirectorUiState {
  project: DirectorProject;
}

export interface DirectorClipboardEntry {
  object: DirectorObject;
  camera?: DirectorCameraShot;
}

interface DirectorInternalState {
  clipboard: DirectorClipboardEntry[];
  clipboardPasteCount: number;
  undoStack: DirectorState[];
  undoBatchDepth: number;
  undoBatchSnapshot: DirectorState | null;
  undoBatchHasTrackedChanges: boolean;
}

export interface DirectorActions {
  setViewMode: (mode: ViewMode) => void;
  setTransformMode: (mode: TransformMode) => void;
  setViewportAspectRatio: (ratio: ViewportAspectRatio) => void;
  setViewportRuleOfThirdsEnabled: (enabled: boolean) => void;
  toggleViewportPanelsCollapsed: () => void;
  setViewportPanelsCollapsed: (collapsed: boolean) => void;
  setCameraMonitorCollapsed: (collapsed: boolean) => void;
  setPoseEditMode: (enabled: boolean) => void;
  selectObject: (id: string | null) => void;
  selectCrowd: (crowdId: string | null) => void;
  toggleObjectSelection: (id: string) => void;
  openSceneInspector: () => void;
  updateScene: (patch: Partial<SceneSettings>) => void;
  removePanoramaAsset: () => void;
  removeImportedAsset: (assetId: string) => void;
  updateObjectTransform: (id: string, patch: Partial<DirectorTransform>) => void;
  updateObjectPivot: (id: string, pivot: [number, number, number]) => void;
  setObjectParent: (id: string, parentId: string | null) => void;
  updateCrowdTransform: (crowdId: string, patch: Partial<DirectorTransform>) => void;
  updateObjectName: (id: string, name: string) => void;
  updateCrowdLabel: (crowdId: string, label: string) => void;
  updateObjectColor: (id: string, color: string) => void;
  updateObjectMaterial: (id: string, material: DirectorMaterialSettings) => void;
  updateObjectGeometryAnchor: (id: string, anchor: "base" | "center") => void;
  updateObjectGeometrySize: (id: string, size: [number, number, number]) => void;
  setObjectAssemblyMetadata: (
    id: string,
    metadata: { assemblyRootId?: string | null; assemblySelectionMode?: "whole" | "parts" }
  ) => void;
  updateCrowdColor: (crowdId: string, color: string) => void;
  updateCharacterBodyType: (id: string, bodyType: CharacterBodyType) => void;
  updateUniformScale: (id: string, scale: number) => void;
  updateCrowdUniformScale: (crowdId: string, scale: number) => void;
  addImportedAsset: (input: ImportedAssetInput) => void;
  attachImportedAssetToCharacter: (id: string, input: ImportedAssetInput) => boolean;
  clearCharacterAsset: (id: string) => void;
  addObjectFromAsset: (assetId: string) => string | null;
  addPresetCharacter: (bodyType?: CharacterBodyType) => void;
  addCrowdCharacters: (input: CrowdCharactersInput) => string[];
  addGeometryPrimitive: (geometryType: GeometryPrimitiveType) => void;
  addGroup: (input?: {
    name?: string;
    parentId?: string | null;
    transform?: Partial<DirectorTransform>;
    pivot?: [number, number, number];
    assemblySelectionMode?: "whole" | "parts";
  }) => string;
  groupObjects: (objectIds?: string[], name?: string) => string | null;
  setObjectAnimationTrack: (id: string, track: ObjectAnimationTrack | null) => void;
  addAnimationSequence: (sequence: DirectorAnimationSequence) => string;
  updateAnimationSequence: (id: string, patch: Partial<DirectorAnimationSequence>) => void;
  deleteAnimationSequence: (id: string) => void;
  setActiveAnimationSequence: (id: string | null) => void;
  replaceAnimationSequences: (sequences: DirectorAnimationSequence[]) => void;
  addCameraShot: (snapshot?: CameraShotSnapshot) => string;
  addCameraAnimation: (input: {
    cameraId: string;
    name?: string;
    keyframes: DirectorCameraAnimationKeyframe[];
  }) => string;
  deleteCameraAnimation: (animationId: string) => void;
  replaceCameraAnimations: (animations: DirectorCameraAnimation[]) => void;
  deleteSelectedObject: () => void;
  toggleObjectVisible: (id: string) => void;
  toggleObjectLocked: (id: string) => void;
  applyPosePreset: (id: string, presetId: PosePresetId) => void;
  applyCrowdPosePreset: (crowdId: string, presetId: PosePresetId) => void;
  updatePoseControl: (id: string, key: string, value: number) => void;
  updatePoseControls: (id: string, controls: Record<string, number>) => void;
  replacePoseControls: (id: string, controls: Record<string, number>) => void;
  updateCrowdPoseControl: (crowdId: string, key: string, value: number) => void;
  setCharacterActionTrack: (id: string, track: CharacterActionTrack | null) => void;
  setCrowdCharacterActionTrack: (crowdId: string, track: CharacterActionTrack | null) => void;
  addCharacterMotionClip: (input: Omit<CharacterMotionClip, "id">) => string;
  deleteCharacterMotionClip: (clipId: string) => void;
  setScenePlan: (plan: ScenePlan | null) => void;
  setActiveCamera: (cameraId: string) => void;
  addCameraCaptures: (cameraId: string | null | undefined, dataUrls: string[]) => void;
  updateCamera: (
    cameraId: string,
    patch: Partial<DirectorCameraShot> & {
      transform?: DirectorTransform;
      target?: [number, number, number];
    }
  ) => void;
  updateCameraForPlayback: (
    cameraId: string,
    patch: Partial<DirectorCameraShot> & {
      transform?: DirectorTransform;
      target?: [number, number, number];
    }
  ) => void;
  beginUndoBatch: () => void;
  endUndoBatch: () => void;
  copySelectedObjects: () => void;
  pasteClipboardObjects: () => void;
  undo: () => void;
  openScopedScene: (scopeId: string | null | undefined) => void;
  resetDirectorDesk: () => void;
  replaceProject: (project: DirectorProject) => void;
  saveLatestSnapshot: () => void;
  restoreLatestSnapshot: () => void;
}

type DirectorRuntimeState = DirectorState & DirectorInternalState;

export type DirectorStore = DirectorRuntimeState & DirectorActions;

const DEFAULT_SCENE: SceneSettings = {
  scale: 1,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  backgroundColor: "#000000",
  panoramaYaw: 0,
  panoramaRadius: 60,
  showLabels: true,
  snapToGrid: false,
  showGrid: true,
  showGround: true,
  groundOpacity: 0.4,
  groundHeight: 0,
};

const CHARACTER_COLOR_PALETTE = [
  "#4F8EF7",
  "#E0524D",
  "#E91E63",
  "#F2A900",
  "#9C4DCC",
  "#12B886",
  "#00B8D9",
  "#FF7A45",
];
const GEOMETRY_PRIMITIVE_COLOR = "#d7e7ff";
const ADDED_MODEL_WORLD_SPACING = 1.25;
const COPY_PASTE_POSITION_OFFSET = 0.6;
const UNDO_STACK_LIMIT = 80;
const LOCAL_MODEL_LIBRARY_STORAGE_KEY = "storyai-3d-director-local-model-library";
const DIRECTOR_SCENE_STORAGE_KEY = "storyai-3d-director-desk-demo";
const DIRECTOR_SCENE_STORAGE_KEY_PREFIX = `${DIRECTOR_SCENE_STORAGE_KEY}:`;
const DEFAULT_UI_STATE: DirectorUiState = {
  viewMode: "director",
  selectedObjectId: null,
  selectedObjectIds: [],
  selectedCrowdId: null,
  directorInspectorMode: "auto",
  transformMode: "translate",
  viewportAspectRatio: "auto",
  viewportRuleOfThirdsEnabled: false,
  viewportPanelsCollapsed: false,
  cameraMonitorCollapsed: false,
  poseEditMode: false,
};

function normalizeDirectorScenePersistenceScopeId(scopeId: string | null | undefined) {
  return typeof scopeId === "string" ? scopeId.trim() : "";
}

function getInitialDirectorScenePersistenceScopeId() {
  if (typeof window === "undefined") return null;

  try {
    const params = new URLSearchParams(window.location.search);
    return normalizeDirectorScenePersistenceScopeId(params.get("instanceId")) || null;
  } catch {
    return null;
  }
}

let directorScenePersistenceScopeId: string | null = getInitialDirectorScenePersistenceScopeId();

function getDirectorSceneStorageKey(scopeId: string | null | undefined = directorScenePersistenceScopeId) {
  const normalizedScopeId = normalizeDirectorScenePersistenceScopeId(scopeId);
  return normalizedScopeId ? `${DIRECTOR_SCENE_STORAGE_KEY_PREFIX}${normalizedScopeId}` : DIRECTOR_SCENE_STORAGE_KEY;
}

function setDirectorScenePersistenceScopeId(scopeId: string | null | undefined) {
  const normalizedScopeId = normalizeDirectorScenePersistenceScopeId(scopeId);
  directorScenePersistenceScopeId = normalizedScopeId || null;
}

function createTransform(
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1]
): DirectorTransform {
  return { position, rotation, scale };
}

function roundTransformValue(value: number) {
  return Number(value.toFixed(6));
}

function roundTransformTuple(values: [number, number, number]): [number, number, number] {
  return values.map((value) => roundTransformValue(value)) as [number, number, number];
}

function formatSceneItemName(prefix: "角色" | "机位", index: number) {
  return `${prefix}${String(index).padStart(2, "0")}`;
}

function getNextSequentialId(existingIds: string[], prefix: string, minimumIndex = 1) {
  let maxIndex = minimumIndex - 1;

  for (const id of existingIds) {
    if (!id.startsWith(prefix)) continue;

    const suffix = id.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;

    maxIndex = Math.max(maxIndex, Number.parseInt(suffix, 10));
  }

  return `${prefix}${maxIndex + 1}`;
}

function isLocalModelLibraryAsset(asset: DirectorAssetRef) {
  return asset.sourceType === "model" && asset.kind !== "panorama" && asset.assetSource === "local";
}

function getLocalStorageSafe() {
  if (typeof localStorage === "undefined") return null;

  return localStorage;
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readPersistedLocalModelAssets() {
  const storage = getLocalStorageSafe();
  if (!storage) return [];

  try {
    const snapshot = storage.getItem(LOCAL_MODEL_LIBRARY_STORAGE_KEY);
    if (!snapshot) return [];

    const parsed = JSON.parse(snapshot);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (asset): asset is DirectorAssetRef =>
        asset &&
        typeof asset.id === "string" &&
        typeof asset.fileName === "string" &&
        typeof asset.url === "string" &&
        isLocalModelLibraryAsset(asset)
    );
  } catch {
    return [];
  }
}

function writePersistedLocalModelAssets(assets: DirectorAssetRef[]) {
  const storage = getLocalStorageSafe();
  if (!storage) return;

  try {
    storage.setItem(LOCAL_MODEL_LIBRARY_STORAGE_KEY, JSON.stringify(assets.filter(isLocalModelLibraryAsset)));
  } catch {
    // Local model files can exceed browser storage limits; keep the current scene usable if persistence fails.
  }
}

function persistLocalModelAsset(asset: DirectorAssetRef) {
  if (!isLocalModelLibraryAsset(asset)) return;

  const persistedAssets = readPersistedLocalModelAssets().filter((item) => item.id !== asset.id);
  writePersistedLocalModelAssets([...persistedAssets, asset]);
}

function removePersistedLocalModelAsset(assetId: string) {
  writePersistedLocalModelAssets(readPersistedLocalModelAssets().filter((asset) => asset.id !== assetId));
}

function isDirectorProjectShape(value: unknown): value is DirectorProject {
  if (!value || typeof value !== "object") return false;

  const project = value as Partial<DirectorProject>;
  return (
    project.version === 1 &&
    Array.isArray(project.assets) &&
    Array.isArray(project.objects) &&
    Array.isArray(project.cameras) &&
    Boolean(project.scene) &&
    typeof project.scene?.backgroundColor === "string"
  );
}

function withPersistedLocalAssets(project: DirectorProject, includePersistedLocalAssets = false): DirectorProject {
  if (!includePersistedLocalAssets) return project;

  const persistedAssets = readPersistedLocalModelAssets();
  if (!persistedAssets.length) return project;

  const existingAssetIds = new Set(project.assets.map((asset) => asset.id));

  return {
    ...project,
    assets: [...project.assets, ...persistedAssets.filter((asset) => !existingAssetIds.has(asset.id))],
  };
}

function isSafeAsset(asset: unknown): asset is DirectorAssetRef {
  return Boolean(
    asset &&
      typeof asset === "object" &&
      typeof (asset as DirectorAssetRef).id === "string" &&
      typeof (asset as DirectorAssetRef).fileName === "string" &&
      typeof (asset as DirectorAssetRef).url === "string" &&
      ((asset as DirectorAssetRef).sourceType === "model" || (asset as DirectorAssetRef).sourceType === "image")
  );
}

function isFiniteVector(value: unknown, length: number) {
  return Array.isArray(value) && value.length === length && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

function isSafeObject(object: unknown): object is DirectorObject {
  const value = object as DirectorObject | null;
  return Boolean(
    value &&
      typeof value.id === "string" &&
      typeof value.name === "string" &&
      ["character", "scene", "prop", "group", "camera", "panorama"].includes(value.kind) &&
      value.transform &&
      isFiniteVector(value.transform.position, 3) &&
      isFiniteVector(value.transform.rotation, 3) &&
      isFiniteVector(value.transform.scale, 3)
  );
}

function isSafeCamera(camera: unknown): camera is DirectorCameraShot {
  const value = camera as DirectorCameraShot | null;
  return Boolean(
    value &&
      typeof value.id === "string" &&
      typeof value.name === "string" &&
      typeof value.fov === "number" &&
      value.transform &&
      isFiniteVector(value.transform.position, 3) &&
      isFiniteVector(value.target, 3)
  );
}

function isSafeMotionClip(clip: unknown): clip is CharacterMotionClip {
  const value = clip as CharacterMotionClip | null;
  return Boolean(
    value &&
      typeof value.id === "string" &&
      typeof value.characterId === "string" &&
      typeof value.name === "string" &&
      typeof value.duration === "number" &&
      Number.isFinite(value.duration) &&
      Array.isArray(value.frames) &&
      value.frames.every(
        (frame) =>
          frame &&
          typeof frame.time === "number" &&
          Number.isFinite(frame.time) &&
          frame.controls &&
          typeof frame.controls === "object" &&
          Object.values(frame.controls).every((control) => typeof control === "number" && Number.isFinite(control))
      )
  );
}

function normalizeObjectAnimationTrack(track: unknown, objectId: string, objectName: string): ObjectAnimationTrack | undefined {
  if (!track || typeof track !== "object") return undefined;
  const value = track as Partial<ObjectAnimationTrack>;
  const requestedDuration = typeof value.duration === "number" && Number.isFinite(value.duration) ? value.duration : 5;
  const duration = ([5, 10, 15] as const).reduce((nearest, candidate) =>
    Math.abs(candidate - requestedDuration) < Math.abs(nearest - requestedDuration) ? candidate : nearest
  );
  const keyframes = Array.isArray(value.keyframes)
    ? value.keyframes.flatMap((keyframe) => {
        if (!keyframe || typeof keyframe.time !== "number" || !Number.isFinite(keyframe.time)) return [];
        return [{
          time: Math.max(0, keyframe.time),
          position: isFiniteVector(keyframe.position, 3) ? keyframe.position : undefined,
          rotation: isFiniteVector(keyframe.rotation, 3) ? keyframe.rotation : undefined,
          scale: isFiniteVector(keyframe.scale, 3) ? keyframe.scale : undefined,
        }];
      })
    : [];
  const pathPoints = Array.isArray(value.path?.points)
    ? value.path.points.filter((point): point is [number, number, number] => isFiniteVector(point, 3))
    : [];
  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id : `object_animation_${objectId}`,
    name: typeof value.name === "string" && value.name.trim() ? value.name : `${objectName}动画`,
    duration,
    loop: value.loop !== false,
    enabled: value.enabled !== false,
    playbackMode:
      value.playbackMode === "camera-driven" || value.playbackMode === "recording-sync"
        ? value.playbackMode
        : "normal",
    cameraId: typeof value.cameraId === "string" ? value.cameraId : null,
    keyframes,
    path:
      value.path && pathPoints.length >= 2
        ? {
            type: value.path.type === "linear" ? "linear" : "curve",
            closed: Boolean(value.path.closed),
            orientToPath: Boolean(value.path.orientToPath),
            points: pathPoints,
          }
        : undefined,
  };
}

function normalizeAnimationSequence(
  input: unknown,
  objects: DirectorObject[],
  cameras: DirectorCameraShot[]
): DirectorAnimationSequence | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Partial<DirectorAnimationSequence>;
  if (typeof value.id !== "string" || typeof value.name !== "string") return null;
  const requestedDuration = typeof value.duration === "number" ? value.duration : 5;
  const duration = ([5, 10, 15] as const).reduce((nearest, candidate) =>
    Math.abs(candidate - requestedDuration) < Math.abs(nearest - requestedDuration) ? candidate : nearest
  );
  const objectIds = new Set(objects.map((object) => object.id));
  const bindings = Array.isArray(value.bindings)
    ? value.bindings.flatMap((binding) =>
        binding &&
        typeof binding.alias === "string" &&
        typeof binding.objectId === "string" &&
        objectIds.has(binding.objectId)
          ? [{ alias: binding.alias, objectId: binding.objectId, objectName: binding.objectName || objects.find((object) => object.id === binding.objectId)?.name || binding.alias }]
          : []
      )
    : [];
  const aliases = new Set(bindings.map((binding) => binding.alias));
  const tracks: DirectorAnimationSequence["tracks"] = [];
  if (Array.isArray(value.tracks)) {
    value.tracks.forEach((track) => {
        if (!track || typeof track.id !== "string" || typeof track.binding !== "string" || !aliases.has(track.binding)) return;
        const startTime = Math.min(duration, Math.max(0, Number(track.startTime ?? 0)));
        const endTime = Math.min(duration, Math.max(startTime + 0.001, Number(track.endTime ?? duration)));
        const base = {
          id: track.id,
          name: typeof track.name === "string" ? track.name : track.id,
          binding: track.binding,
          startTime,
          endTime,
          loop: Boolean(track.loop),
          blendIn: Math.max(0, Number(track.blendIn ?? 0)),
          blendOut: Math.max(0, Number(track.blendOut ?? 0)),
        };
        if (track.type === "character") {
          tracks.push({
            ...base,
            type: "character" as const,
            actionId: track.actionId,
            motionClipId: typeof track.motionClipId === "string" ? track.motionClipId : null,
          });
          return;
        }
        if (track.type === "object") {
          const keyframes = Array.isArray(track.keyframes)
            ? track.keyframes.flatMap((keyframe) => {
                if (!keyframe || typeof keyframe !== "object" || !Number.isFinite(keyframe.time)) return [];
                return [{
                  time: Math.min(endTime - startTime, Math.max(0, Number(keyframe.time))),
                  position: isFiniteVector(keyframe.position, 3) ? keyframe.position : undefined,
                  rotation: isFiniteVector(keyframe.rotation, 3) ? keyframe.rotation : undefined,
                  scale: isFiniteVector(keyframe.scale, 3) ? keyframe.scale : undefined,
                }];
              })
            : [];
          const pathPoints = Array.isArray(track.path?.points)
            ? track.path.points.filter((point): point is [number, number, number] => isFiniteVector(point, 3))
            : [];
          tracks.push({
            ...base,
            type: "object" as const,
            keyframes,
            path: track.path && pathPoints.length >= 2
              ? {
                  type: track.path.type === "linear" ? "linear" : "curve",
                  closed: Boolean(track.path.closed),
                  orientToPath: Boolean(track.path.orientToPath),
                  points: pathPoints,
                }
              : undefined,
          });
        }
      });
  }
  const rawPlaybackMode = value.playbackMode as string | undefined;
  const playbackMode = rawPlaybackMode === "recording" || rawPlaybackMode === "recording-sync"
    ? "recording"
    : rawPlaybackMode === "camera-motion" || rawPlaybackMode === "camera-driven"
      ? "camera-motion"
      : "manual";
  return {
    id: value.id,
    name: value.name,
    duration,
    playbackMode,
    loop: value.loop !== false,
    enabled: value.enabled !== false,
    cameraId: typeof value.cameraId === "string" && cameras.some((camera) => camera.id === value.cameraId) ? value.cameraId : null,
    bindings,
    tracks,
  };
}

function migrateDirectorProject(project: DirectorProject | null | undefined): DirectorProject {
  const fallback = createDefaultDirectorProject();
  if (!project || typeof project !== "object" || !Array.isArray(project.assets) || !Array.isArray(project.objects) || !Array.isArray(project.cameras)) {
    return fallback;
  }

  const assets = project.assets.filter(isSafeAsset);
  const objects = project.objects.filter(isSafeObject);
  const cameras = project.cameras.filter(isSafeCamera);
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const cameraIds = new Set(cameras.map((camera) => camera.id));
  const objectById = new Map(objects.map((object) => [object.id, object]));
  const getSafeParentId = (object: DirectorObject) => {
    if (!object.parentId || object.parentId === object.id || !objectById.has(object.parentId)) return null;
    const visited = new Set<string>([object.id]);
    let parentId: string | null | undefined = object.parentId;
    while (parentId) {
      if (visited.has(parentId)) return null;
      visited.add(parentId);
      parentId = objectById.get(parentId)?.parentId;
    }
    return object.parentId;
  };

  const animationSequences = (project.animationSequences ?? [])
    .map((sequence) => normalizeAnimationSequence(sequence, objects, cameras))
    .filter((sequence): sequence is DirectorAnimationSequence => Boolean(sequence));
  const activeAnimationSequenceId = animationSequences.some((sequence) => sequence.id === project.activeAnimationSequenceId)
    ? project.activeAnimationSequenceId ?? null
    : animationSequences[0]?.id ?? null;

  return {
    ...project,
    assets,
    cameras,
    scene: {
      ...fallback.scene,
      ...(project.scene && typeof project.scene === "object" ? project.scene : {}),
      showGrid: project.scene?.showGrid ?? true,
    },
    cameraAnimations: (project.cameraAnimations ?? []).filter(
      (animation) =>
        animation &&
        typeof animation.id === "string" &&
        typeof animation.cameraId === "string" &&
        cameraIds.has(animation.cameraId) &&
        Array.isArray(animation.keyframes)
    ),
    characterMotionClips: (project.characterMotionClips ?? []).filter(isSafeMotionClip),
    animationSequences,
    activeAnimationSequenceId,
    scenePlan: project.scenePlan ?? null,
    objects: objects.map((object) => {
      const parentId = getSafeParentId(object);
      const normalizedObject: DirectorObject = {
        ...object,
        parentId,
        pivot: isFiniteVector(object.pivot, 3) ? object.pivot : [0, 0, 0],
        objectAnimationTrack: normalizeObjectAnimationTrack(object.objectAnimationTrack, object.id, object.name),
      };
      if (object.kind !== "character") return normalizedObject;

      const asset = object.assetRefId ? assetsById.get(object.assetRefId) : undefined;
      // Older AnimoFlow runs referenced a transient service URL. It cannot survive a
      // director-desk restart, so keep the role editable as a standard mannequin.
      if (asset?.url.startsWith("/api/animoflow/files/")) {
        return {
          ...normalizedObject,
          assetRefId: undefined,
          characterActionTrack: undefined,
        };
      }

      const rig = object.characterRig;
      if (rig?.rigType === "ue4-mannequin") return normalizedObject;

      return {
        ...normalizedObject,
        characterRig: {
          rigType: "ue4-mannequin",
          posePresetId: rig?.posePresetId ?? "stand",
          controls: rig?.controls ?? {},
        },
      };
    }),
  };
}

function extractPersistedDirectorState(state: DirectorRuntimeState): DirectorState {
  return cloneJsonValue({
    viewMode: state.viewMode,
    selectedObjectId: state.selectedObjectId,
    selectedObjectIds: state.selectedObjectIds,
    selectedCrowdId: state.selectedCrowdId,
    directorInspectorMode: state.directorInspectorMode,
    transformMode: state.transformMode,
    viewportAspectRatio: state.viewportAspectRatio,
    viewportRuleOfThirdsEnabled: state.viewportRuleOfThirdsEnabled,
    viewportPanelsCollapsed: state.viewportPanelsCollapsed,
    cameraMonitorCollapsed: state.cameraMonitorCollapsed,
    // Pose editing is a transient tool. Restoring it on a later launch can lock
    // the viewport unexpectedly before the user explicitly opens the editor.
    poseEditMode: false,
    project: state.project,
  });
}

function writePersistedDirectorState(state: DirectorState) {
  const storage = getLocalStorageSafe();
  if (!storage) return;

  try {
    storage.setItem(getDirectorSceneStorageKey(), JSON.stringify(state));
  } catch {
    // Keep the editor usable if the browser storage quota is exceeded.
  }
}

function createStateFromPersistedProject(project: DirectorProject, options: DirectorStateOptions = {}): DirectorState {
  return {
    ...DEFAULT_UI_STATE,
    project: withPersistedLocalAssets(migrateDirectorProject(cloneJsonValue(project)), options.includePersistedLocalAssets),
  };
}

function readPersistedDirectorState(options: DirectorStateOptions = {}): DirectorState | null {
  const storage = getLocalStorageSafe();
  if (!storage) return null;

  try {
    const snapshot = storage.getItem(getDirectorSceneStorageKey(options.persistenceScopeId));
    if (!snapshot) return null;

    const parsed = JSON.parse(snapshot) as unknown;

    if (isDirectorProjectShape(parsed)) {
      return createStateFromPersistedProject(parsed, options);
    }

    if (!parsed || typeof parsed !== "object") return null;

    const state = parsed as Partial<DirectorState>;
    if (!isDirectorProjectShape(state.project)) return null;

    return {
      viewMode: state.viewMode === "camera" ? "camera" : "director",
      selectedObjectId: typeof state.selectedObjectId === "string" ? state.selectedObjectId : null,
      selectedObjectIds: Array.isArray(state.selectedObjectIds)
        ? state.selectedObjectIds.filter((item): item is string => typeof item === "string")
        : [],
      selectedCrowdId: typeof state.selectedCrowdId === "string" ? state.selectedCrowdId : null,
      directorInspectorMode: state.directorInspectorMode === "scene" ? "scene" : "auto",
      transformMode:
        state.transformMode === "rotate" || state.transformMode === "scale" ? state.transformMode : "translate",
      viewportAspectRatio: state.viewportAspectRatio ?? "auto",
      viewportRuleOfThirdsEnabled: Boolean(state.viewportRuleOfThirdsEnabled),
      viewportPanelsCollapsed: Boolean(state.viewportPanelsCollapsed),
      cameraMonitorCollapsed: Boolean(state.cameraMonitorCollapsed),
      poseEditMode: false,
      project: withPersistedLocalAssets(
        migrateDirectorProject(cloneJsonValue(state.project)),
        options.includePersistedLocalAssets
      ),
    };
  } catch {
    return null;
  }
}

function createRuntimeStateFromPersistedState(state: DirectorState): DirectorRuntimeState {
  const snapshot = cloneJsonValue(state);

  return {
    ...snapshot,
    clipboard: [],
    clipboardPasteCount: 0,
    undoStack: [],
    undoBatchDepth: 0,
    undoBatchSnapshot: null,
    undoBatchHasTrackedChanges: false,
  };
}

function createUndoStackEntry(state: DirectorRuntimeState) {
  return extractPersistedDirectorState(state);
}

export function createDefaultDirectorProject({
  includePersistedLocalAssets = false,
}: {
  includePersistedLocalAssets?: boolean;
} = {}): DirectorProject {
  const camera: DirectorCameraShot = {
    id: "cam_1",
    name: formatSceneItemName("机位", 1),
    fov: DEFAULT_DIRECTOR_CAMERA_VIEW_SNAPSHOT.fov,
    transform: createTransform(getCameraRigPositionFromViewSnapshot(DEFAULT_DIRECTOR_CAMERA_VIEW_SNAPSHOT)),
    targetMode: "manual",
    target: DEFAULT_DIRECTOR_CAMERA_VIEW_SNAPSHOT.target,
    lastCaptureUrl: null,
    captures: [],
  };

  const role: DirectorObject = {
    id: "char_default_a",
    name: formatSceneItemName("角色", 1),
    kind: "character",
    visible: true,
    locked: false,
    bodyType: DEFAULT_CHARACTER_BODY_TYPE,
    color: "#4F8EF7",
    transform: createTransform([0, 0, 0]),
    characterRig: {
      rigType: "ue4-mannequin",
      posePresetId: "stand",
      controls: {},
    },
  };

  const cameraObject: DirectorObject = {
    id: "cam_object_1",
    name: camera.name,
    kind: "camera",
    visible: true,
    locked: false,
    linkedCameraId: camera.id,
    transform: camera.transform,
  };

  return {
    version: 1,
    scene: DEFAULT_SCENE,
    assets: includePersistedLocalAssets ? readPersistedLocalModelAssets() : [],
    objects: [role, cameraObject],
    cameras: [camera],
    cameraAnimations: [],
    characterMotionClips: [],
    animationSequences: [],
    activeAnimationSequenceId: null,
    activeCameraId: camera.id,
    panoramaAssetId: null,
    scenePlan: null,
  };
}

export function createInitialDirectorState(options: DirectorStateOptions = {}): DirectorState {
  const persistedState = options.includePersistedScene ? readPersistedDirectorState(options) : null;

  if (persistedState) {
    return persistedState;
  }

  return {
    ...DEFAULT_UI_STATE,
    project: createDefaultDirectorProject({ includePersistedLocalAssets: options.includePersistedLocalAssets }),
  };
}

function updateObjectById(
  objects: DirectorObject[],
  id: string,
  updater: (item: DirectorObject) => DirectorObject
) {
  return objects.map((item) => (item.id === id ? updater(item) : item));
}

function getNextCharacterColor(objects: DirectorObject[]) {
  const usedColors = new Set(objects.filter((item) => item.kind === "character").map((item) => item.color));
  const unusedColor = CHARACTER_COLOR_PALETTE.find((color) => !usedColors.has(color));

  if (unusedColor) return unusedColor;

  const characterCount = objects.filter((item) => item.kind === "character").length;
  return CHARACTER_COLOR_PALETTE[characterCount % CHARACTER_COLOR_PALETTE.length];
}

function getGeometryPrimitiveLabel(geometryType: GeometryPrimitiveType) {
  return GEOMETRY_PRIMITIVE_OPTIONS.find((option) => option.type === geometryType)?.label ?? "几何模型";
}

function getAddedModelColumnOffset(index: number) {
  const side = index % 2 === 1 ? -1 : 1;
  const step = Math.ceil(index / 2);

  return side * step * ADDED_MODEL_WORLD_SPACING;
}

function getCrowdCharacterPositions(rows: number, columns: number, spacing: number) {
  const safeRows = Math.max(1, rows);
  const safeColumns = Math.max(1, columns);
  const safeSpacing = Math.max(0.1, spacing);
  const xOffset = ((safeColumns - 1) * safeSpacing) / 2;
  const zOffset = ((safeRows - 1) * safeSpacing) / 2;
  const positions: Array<[number, number, number]> = [];

  for (let rowIndex = 0; rowIndex < safeRows; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < safeColumns; columnIndex += 1) {
      positions.push([
        Number((columnIndex * safeSpacing - xOffset).toFixed(4)),
        0,
        Number((rowIndex * safeSpacing - zOffset).toFixed(4)),
      ]);
    }
  }

  return positions;
}

function getCrowdCharacterOffset(objects: DirectorObject[], spacing: number): [number, number, number] {
  const safeSpacing = Math.max(0.1, spacing);
  const characterPositions = objects
    .filter((item) => item.kind === "character")
    .map((item) => item.transform.position);
  const maxZ = characterPositions.length ? Math.max(...characterPositions.map((position) => position[2])) : 0;

  return [0, 0, Number((maxZ + safeSpacing * 2).toFixed(4))];
}

function formatCrowdLabel(rows: number, columns: number) {
  return `群众（${rows}x${columns}）`;
}

function buildPresetCharacterObject(
  state: DirectorRuntimeState,
  bodyType: CharacterBodyType,
  position: [number, number, number],
  crowdMetadata?: {
    crowdId: string;
    crowdLabel: string;
  }
) {
  const characterCount = state.project.objects.filter((item) => item.kind === "character").length;
  const characterIndex = characterCount + 1;
  const objectId = getNextSequentialId(
    state.project.objects.map((item) => item.id),
    "char_preset_",
    characterIndex
  );
  const normalizedBodyType = normalizeBodyType(bodyType);

  return {
    id: objectId,
    name: formatSceneItemName("角色", characterIndex),
    kind: "character" as const,
    visible: true,
    locked: false,
    bodyType: normalizedBodyType,
    color: getNextCharacterColor(state.project.objects),
    crowdId: crowdMetadata?.crowdId,
    crowdLabel: crowdMetadata?.crowdLabel,
    transform: createTransform(position),
    characterRig: {
      rigType: "ue4-mannequin" as const,
      posePresetId: "stand",
      controls: {},
    },
  } satisfies DirectorObject;
}

function formatCameraCaptureName(cameraName: string, captureIndex: number) {
  return `${cameraName}-截图${String(captureIndex).padStart(2, "0")}`;
}

function buildCameraCaptures(camera: DirectorCameraShot, dataUrls: string[]) {
  const existingCaptures = camera.captures ?? [];

  return dataUrls.map((dataUrl, indexOffset): DirectorCameraCapture => {
    const captureIndex = existingCaptures.length + indexOffset + 1;

    return {
      id: `${camera.id}-capture-${String(captureIndex).padStart(2, "0")}`,
      index: captureIndex,
      name: formatCameraCaptureName(camera.name, captureIndex),
      dataUrl,
    };
  });
}

function createDisplayNameFromFileName(fileName: string) {
  return fileName.replace(/\.(fbx|obj|jpe?g|png|webp)$/i, "");
}

function createSceneObjectFromAsset(asset: DirectorAssetRef, existingObjects: DirectorObject[]) {
  const nextObjectId = getNextSequentialId(
    existingObjects.map((item) => item.id),
    "obj_",
    existingObjects.length + 1
  );

  return {
    id: nextObjectId,
    name: asset.name ?? createDisplayNameFromFileName(asset.fileName),
    kind: asset.kind,
    visible: true,
    locked: false,
    assetRefId: asset.id,
    transform: createTransform([0, 0, 0]),
  } satisfies DirectorObject;
}

function refreshCamerasFocusedOnObject(cameras: DirectorCameraShot[], object: DirectorObject) {
  return cameras.map((camera) =>
    camera.targetMode === "object" && camera.targetObjectId === object.id
      ? {
          ...camera,
          target: getDirectorObjectFocusTarget(object),
        }
      : camera
  );
}

function refreshCamerasFocusedOnObjects(
  cameras: DirectorCameraShot[],
  objects: DirectorObject[],
  focusedObjectIds: Iterable<string>
) {
  const focusedIdSet = new Set(focusedObjectIds);
  if (focusedIdSet.size === 0) return cameras;

  const objectsById = new Map(objects.map((item) => [item.id, item]));

  return cameras.map((camera) => {
    if (camera.targetMode !== "object" || !camera.targetObjectId || !focusedIdSet.has(camera.targetObjectId)) {
      return camera;
    }

    const targetObject = objectsById.get(camera.targetObjectId);
    if (!targetObject) {
      return {
        ...camera,
        targetMode: "manual" as const,
        targetObjectId: null,
      };
    }

    return {
      ...camera,
      target: getDirectorObjectFocusTarget(targetObject),
    };
  });
}

function getCrowdMemberObjects(objects: DirectorObject[], crowdId: string) {
  return objects.filter((item) => item.kind === "character" && item.crowdId === crowdId);
}

function getCrowdMemberIds(objects: DirectorObject[], crowdId: string) {
  return getCrowdMemberObjects(objects, crowdId).map((item) => item.id);
}

export function getCrowdAnchorTransform(objects: DirectorObject[], crowdId: string): DirectorTransform | null {
  const crowdMembers = getCrowdMemberObjects(objects, crowdId);
  if (!crowdMembers.length) return null;

  const position = crowdMembers.reduce(
    (accumulator, item) => {
      accumulator[0] += item.transform.position[0];
      accumulator[1] += item.transform.position[1];
      accumulator[2] += item.transform.position[2];
      return accumulator;
    },
    [0, 0, 0] as [number, number, number]
  );
  const memberCount = crowdMembers.length;
  const anchorPosition = roundTransformTuple([
    position[0] / memberCount,
    position[1] / memberCount,
    position[2] / memberCount,
  ]);
  const referenceMember = crowdMembers[0];

  return createTransform(
    anchorPosition,
    [...referenceMember.transform.rotation] as [number, number, number],
    [...referenceMember.transform.scale] as [number, number, number]
  );
}

function getNextCrowdId(objects: DirectorObject[]) {
  return getNextSequentialId(
    objects.map((item) => item.crowdId).filter((item): item is string => typeof item === "string"),
    "crowd_",
    1
  );
}

function applyCrowdTransformPatch(
  objects: DirectorObject[],
  crowdId: string,
  patch: Partial<DirectorTransform>
) {
  const anchor = getCrowdAnchorTransform(objects, crowdId);
  if (!anchor) {
    return {
      objects,
      changedObjectIds: [],
    };
  }

  const nextPosition = patch.position ?? anchor.position;
  const nextRotation = patch.rotation ?? anchor.rotation;
  const nextScale = patch.scale ?? anchor.scale;
  const deltaRotation: [number, number, number] = [
    nextRotation[0] - anchor.rotation[0],
    nextRotation[1] - anchor.rotation[1],
    nextRotation[2] - anchor.rotation[2],
  ];
  const scaleRatio: [number, number, number] = [
    anchor.scale[0] === 0 ? 1 : nextScale[0] / anchor.scale[0],
    anchor.scale[1] === 0 ? 1 : nextScale[1] / anchor.scale[1],
    anchor.scale[2] === 0 ? 1 : nextScale[2] / anchor.scale[2],
  ];
  const anchorPosition = anchor.position;
  const changedObjectIds = getCrowdMemberIds(objects, crowdId);
  const changedIdSet = new Set(changedObjectIds);

  return {
    changedObjectIds,
    objects: objects.map((item) => {
      if (!changedIdSet.has(item.id)) return item;

      const offsetX = (item.transform.position[0] - anchorPosition[0]) * scaleRatio[0];
      const offsetY = (item.transform.position[1] - anchorPosition[1]) * scaleRatio[1];
      const offsetZ = (item.transform.position[2] - anchorPosition[2]) * scaleRatio[2];
      const cosX = Math.cos(deltaRotation[0]);
      const sinX = Math.sin(deltaRotation[0]);
      const cosY = Math.cos(deltaRotation[1]);
      const sinY = Math.sin(deltaRotation[1]);
      const cosZ = Math.cos(deltaRotation[2]);
      const sinZ = Math.sin(deltaRotation[2]);

      const x1 = offsetX;
      const y1 = offsetY * cosX - offsetZ * sinX;
      const z1 = offsetY * sinX + offsetZ * cosX;

      const x2 = x1 * cosY + z1 * sinY;
      const y2 = y1;
      const z2 = -x1 * sinY + z1 * cosY;

      const x3 = x2 * cosZ - y2 * sinZ;
      const y3 = x2 * sinZ + y2 * cosZ;
      const z3 = z2;

      return {
        ...item,
        transform: {
          position: roundTransformTuple([
            nextPosition[0] + x3,
            nextPosition[1] + y3,
            nextPosition[2] + z3,
          ]),
          rotation: roundTransformTuple([
            item.transform.rotation[0] + deltaRotation[0],
            item.transform.rotation[1] + deltaRotation[1],
            item.transform.rotation[2] + deltaRotation[2],
          ]),
          scale: roundTransformTuple([
            item.transform.scale[0] * scaleRatio[0],
            item.transform.scale[1] * scaleRatio[1],
            item.transform.scale[2] * scaleRatio[2],
          ]),
        },
      };
    }),
  };
}

function getOrderedSelectedObjectIds(state: DirectorState) {
  if (state.selectedObjectIds.length) return state.selectedObjectIds;
  return state.selectedObjectId ? [state.selectedObjectId] : [];
}

function createObjectIdForDuplicate(existingObjects: DirectorObject[], source: DirectorObject) {
  if (source.kind === "camera") {
    return getNextSequentialId(
      existingObjects.map((item) => item.id),
      "cam_object_",
      existingObjects.filter((item) => item.kind === "camera").length + 1
    );
  }

  if (source.kind === "character") {
    return getNextSequentialId(
      existingObjects.map((item) => item.id),
      "char_paste_",
      existingObjects.filter((item) => item.kind === "character").length + 1
    );
  }

  if (source.geometryType) {
    return getNextSequentialId(
      existingObjects.map((item) => item.id),
      `geo_${source.geometryType}_copy_`,
      existingObjects.length + 1
    );
  }

  return getNextSequentialId(existingObjects.map((item) => item.id), "obj_", existingObjects.length + 1);
}

function applyPositionOffset(position: [number, number, number], offset: number): [number, number, number] {
  return [position[0] + offset, position[1], position[2] + offset];
}

function applyOffsetToTransform(transform: DirectorTransform, offset: number): DirectorTransform {
  return {
    ...transform,
    position: applyPositionOffset(transform.position, offset),
  };
}

function buildClipboardEntries(state: DirectorState): DirectorClipboardEntry[] {
  const selectedObjectIds = getOrderedSelectedObjectIds(state);
  if (!selectedObjectIds.length) return [];

  return selectedObjectIds.flatMap((objectId) => {
    const object = state.project.objects.find((item) => item.id === objectId);
    if (!object) return [];

    const camera =
      object.kind === "camera" && object.linkedCameraId
        ? state.project.cameras.find((item) => item.id === object.linkedCameraId)
        : undefined;

    return [
      {
        object: cloneJsonValue(object),
        camera: camera ? cloneJsonValue(camera) : undefined,
      },
    ];
  });
}

function pasteClipboardEntries(state: DirectorRuntimeState): DirectorRuntimeState {
  if (state.clipboard.length === 0) return state;

  const pasteIteration = state.clipboardPasteCount + 1;
  const offset = COPY_PASTE_POSITION_OFFSET * pasteIteration;
  const nextObjects = [...state.project.objects];
  const nextCameras = [...state.project.cameras];
  const idMap = new Map<string, string>();
  const crowdIdMap = new Map<string, string>();
  const pastedObjectIds: string[] = [];

  function getPastedCrowdId(sourceCrowdId: string) {
    const existing = crowdIdMap.get(sourceCrowdId);
    if (existing) return existing;

    const nextCrowdId = getNextCrowdId(nextObjects);
    crowdIdMap.set(sourceCrowdId, nextCrowdId);
    return nextCrowdId;
  }

  state.clipboard.forEach((entry) => {
    if (entry.object.kind === "camera" && entry.camera) {
      const cameraIndex = nextCameras.length + 1;
      const nextCameraId = getNextSequentialId(
        nextCameras.map((item) => item.id),
        "cam_",
        cameraIndex
      );
      const nextObjectId = createObjectIdForDuplicate(nextObjects, entry.object);
      idMap.set(entry.object.id, nextObjectId);
      if (entry.object.linkedCameraId) {
        idMap.set(entry.object.linkedCameraId, nextCameraId);
      }

      const targetObjectId = entry.camera.targetObjectId ? idMap.get(entry.camera.targetObjectId) : null;
      const nextCamera: DirectorCameraShot = {
        ...entry.camera,
        id: nextCameraId,
        name: formatSceneItemName("机位", cameraIndex),
        transform: applyOffsetToTransform(entry.camera.transform, offset),
        target:
          entry.camera.targetMode === "manual" ? applyPositionOffset(entry.camera.target, offset) : entry.camera.target,
        targetObjectId: targetObjectId ?? entry.camera.targetObjectId ?? null,
        captures: [],
        lastCaptureUrl: null,
      };
      const nextCameraObject: DirectorObject = {
        ...entry.object,
        id: nextObjectId,
        name: nextCamera.name,
        linkedCameraId: nextCamera.id,
        transform: nextCamera.transform,
      };

      nextCameras.push(nextCamera);
      nextObjects.push(nextCameraObject);
      pastedObjectIds.push(nextObjectId);
      return;
    }

    const nextObjectId = createObjectIdForDuplicate(nextObjects, entry.object);
    idMap.set(entry.object.id, nextObjectId);
    const nextCharacterCount =
      entry.object.kind === "character" ? nextObjects.filter((item) => item.kind === "character").length + 1 : null;
    const duplicatedObject: DirectorObject = {
      ...entry.object,
      id: nextObjectId,
      name:
        entry.object.kind === "character" && nextCharacterCount
          ? formatSceneItemName("角色", nextCharacterCount)
          : entry.object.name,
      crowdId: entry.object.crowdId ? getPastedCrowdId(entry.object.crowdId) : entry.object.crowdId,
      transform: applyOffsetToTransform(entry.object.transform, offset),
    };

    nextObjects.push(duplicatedObject);
    pastedObjectIds.push(nextObjectId);
  });

  const nextObjectsById = new Map(nextObjects.map((item) => [item.id, item]));
  const normalizedCameras = nextCameras.map((camera) => {
    if (camera.targetMode !== "object" || !camera.targetObjectId) return camera;

    const mappedTargetObjectId = idMap.get(camera.targetObjectId) ?? camera.targetObjectId;
    const targetObject = nextObjectsById.get(mappedTargetObjectId);
    if (!targetObject) {
      return {
        ...camera,
        targetMode: "manual" as const,
        targetObjectId: null,
      };
    }

    return {
      ...camera,
      targetObjectId: mappedTargetObjectId,
      target: getDirectorObjectFocusTarget(targetObject),
    };
  });
  const lastPastedObject = pastedObjectIds.length
    ? nextObjects.find((item) => item.id === pastedObjectIds[pastedObjectIds.length - 1])
    : null;
  const pastedCrowdIds = Array.from(
    new Set(
      pastedObjectIds
        .map((objectId) => nextObjects.find((item) => item.id === objectId)?.crowdId)
        .filter((crowdId): crowdId is string => typeof crowdId === "string")
    )
  );

  return {
    ...state,
    selectedObjectId: pastedObjectIds[pastedObjectIds.length - 1] ?? null,
    selectedObjectIds: pastedObjectIds,
    selectedCrowdId: pastedCrowdIds.length === 1 ? pastedCrowdIds[0] : null,
    directorInspectorMode: "auto",
    clipboardPasteCount: pasteIteration,
    project: {
      ...state.project,
      objects: nextObjects,
      cameras: normalizedCameras,
      activeCameraId:
        lastPastedObject?.kind === "camera"
          ? lastPastedObject.linkedCameraId ?? state.project.activeCameraId
          : state.project.activeCameraId,
    },
  };
}

function isSameDirectorState(a: DirectorState, b: DirectorState) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function trimUndoStack(stack: DirectorState[]) {
  return stack.length > UNDO_STACK_LIMIT ? stack.slice(stack.length - UNDO_STACK_LIMIT) : stack;
}

export const useDirectorStore = create<DirectorStore>((set, get) => {
  const initialRuntimeState = createRuntimeStateFromPersistedState(
    createInitialDirectorState({ includePersistedLocalAssets: true, includePersistedScene: true })
  );

  function commitMutation(
    updater: (state: DirectorRuntimeState) => DirectorRuntimeState,
    options: { trackUndo?: boolean; persist?: boolean } = {}
  ) {
    const { trackUndo = true, persist = true } = options;

    set((state) => {
      const currentState = state as DirectorRuntimeState;
      const previousSnapshot = createUndoStackEntry(currentState);
      const nextState = updater(currentState);
      const nextSnapshot = extractPersistedDirectorState(nextState);
      const didChange = !isSameDirectorState(previousSnapshot, nextSnapshot);

      if (!didChange) {
        return {
          ...nextState,
          undoStack: trackUndo ? currentState.undoStack : nextState.undoStack,
          undoBatchDepth: nextState.undoBatchDepth,
          undoBatchSnapshot: nextState.undoBatchSnapshot,
          undoBatchHasTrackedChanges: nextState.undoBatchHasTrackedChanges,
        };
      }

      const shouldCaptureUndoBatchSnapshot =
        trackUndo && currentState.undoBatchDepth > 0 && currentState.undoBatchSnapshot === null;
      const nextUndoStack =
        trackUndo && currentState.undoBatchDepth === 0
          ? trimUndoStack([...currentState.undoStack, previousSnapshot])
          : nextState.undoStack;
      const runtimeState: DirectorRuntimeState = {
        ...nextState,
        undoStack: nextUndoStack,
        undoBatchSnapshot: shouldCaptureUndoBatchSnapshot ? previousSnapshot : nextState.undoBatchSnapshot,
        undoBatchHasTrackedChanges:
          trackUndo && currentState.undoBatchDepth > 0 ? true : nextState.undoBatchHasTrackedChanges,
      };

      if (persist) {
        writePersistedDirectorState(extractPersistedDirectorState(runtimeState));
      }

      return runtimeState;
    });
  }

  function commitUiMutation(updater: (state: DirectorRuntimeState) => DirectorRuntimeState) {
    commitMutation(updater, { trackUndo: false, persist: true });
  }

  return {
    ...initialRuntimeState,
    beginUndoBatch: () => {
      set((state) => {
        const currentState = state as DirectorRuntimeState;

        return {
          ...currentState,
          undoBatchDepth: currentState.undoBatchDepth + 1,
          undoBatchSnapshot: currentState.undoBatchDepth === 0 ? createUndoStackEntry(currentState) : currentState.undoBatchSnapshot,
          undoBatchHasTrackedChanges: currentState.undoBatchDepth === 0 ? false : currentState.undoBatchHasTrackedChanges,
        };
      });
    },
    endUndoBatch: () => {
      set((state) => {
        const currentState = state as DirectorRuntimeState;
        if (currentState.undoBatchDepth === 0) return currentState;

        const nextUndoBatchDepth = currentState.undoBatchDepth - 1;
        if (nextUndoBatchDepth > 0) {
          return {
            ...currentState,
            undoBatchDepth: nextUndoBatchDepth,
          };
        }

        const currentSnapshot = extractPersistedDirectorState(currentState);
        const shouldPushUndoEntry =
          currentState.undoBatchHasTrackedChanges &&
          currentState.undoBatchSnapshot !== null &&
          !isSameDirectorState(currentState.undoBatchSnapshot, currentSnapshot);

        return {
          ...currentState,
          undoStack: shouldPushUndoEntry
            ? trimUndoStack([...currentState.undoStack, currentState.undoBatchSnapshot!])
            : currentState.undoStack,
          undoBatchDepth: 0,
          undoBatchSnapshot: null,
          undoBatchHasTrackedChanges: false,
        };
      });
    },
    setTransformMode: (mode) =>
      commitUiMutation((state) => ({
        ...state,
        transformMode: mode,
      })),
    setViewportAspectRatio: (ratio) =>
      commitUiMutation((state) => ({
        ...state,
        viewportAspectRatio: ratio,
      })),
    setViewportRuleOfThirdsEnabled: (enabled) =>
      commitUiMutation((state) => ({
        ...state,
        viewportRuleOfThirdsEnabled: enabled,
      })),
    toggleViewportPanelsCollapsed: () =>
      commitUiMutation((state) => ({
        ...state,
        viewportPanelsCollapsed: !state.viewportPanelsCollapsed,
      })),
    setViewportPanelsCollapsed: (collapsed) =>
      commitUiMutation((state) => ({
        ...state,
        viewportPanelsCollapsed: collapsed,
      })),
    setCameraMonitorCollapsed: (collapsed) =>
      commitUiMutation((state) => ({
        ...state,
        cameraMonitorCollapsed: collapsed,
      })),
    setViewMode: (mode) =>
      commitUiMutation((state) => ({
        ...state,
        viewMode: mode,
        project: {
          ...state.project,
          activeCameraId:
            mode === "camera"
              ? state.project.activeCameraId ?? state.project.cameras[0]?.id ?? null
              : state.project.activeCameraId,
        },
      })),
    selectObject: (id) =>
      commitUiMutation((state) => {
        const selectedObject = state.project.objects.find((item) => item.id === id);

        return {
          ...state,
          selectedObjectId: id,
          selectedObjectIds: id ? [id] : [],
          selectedCrowdId: null,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            activeCameraId:
              selectedObject?.kind === "camera" && selectedObject.linkedCameraId
                ? selectedObject.linkedCameraId
                : state.project.activeCameraId,
          },
        };
      }),
    setPoseEditMode: (enabled) =>
      commitUiMutation((state) => ({
        ...state,
        poseEditMode: enabled,
      })),
    selectCrowd: (crowdId) =>
      commitUiMutation((state) => {
        if (!crowdId) {
          return {
            ...state,
            selectedCrowdId: null,
            selectedObjectId: null,
            selectedObjectIds: [],
          };
        }

        const crowdMemberIds = getCrowdMemberIds(state.project.objects, crowdId);
        if (!crowdMemberIds.length) return state;

        return {
          ...state,
          selectedCrowdId: crowdId,
          selectedObjectId: crowdMemberIds[crowdMemberIds.length - 1] ?? null,
          selectedObjectIds: crowdMemberIds,
          directorInspectorMode: "auto",
        };
      }),
    toggleObjectSelection: (id) =>
      commitUiMutation((state) => {
        const selectedObject = state.project.objects.find((item) => item.id === id);
        if (!selectedObject) return state;

        const selectedObjectIds = getOrderedSelectedObjectIds(state);
        const nextSelectedObjectIds = selectedObjectIds.includes(id)
          ? selectedObjectIds.filter((itemId) => itemId !== id)
          : [...selectedObjectIds, id];
        const nextSelectedObjectId = nextSelectedObjectIds[nextSelectedObjectIds.length - 1] ?? null;

        return {
          ...state,
          selectedObjectId: nextSelectedObjectId,
          selectedObjectIds: nextSelectedObjectIds,
          selectedCrowdId: null,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            activeCameraId:
              selectedObject.kind === "camera" && selectedObject.linkedCameraId
                ? selectedObject.linkedCameraId
                : state.project.activeCameraId,
          },
        };
      }),
    openSceneInspector: () =>
      commitUiMutation((state) => ({
        ...state,
        directorInspectorMode: "scene",
        selectedObjectId: null,
        selectedObjectIds: [],
        selectedCrowdId: null,
      })),
    updateScene: (patch) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          scene: {
            ...state.project.scene,
            ...patch,
          },
        },
      })),
    removePanoramaAsset: () =>
      commitMutation((state) => {
        const panoramaAssetId = state.project.panoramaAssetId;
        if (!panoramaAssetId) return state;

        return {
          ...state,
          project: {
            ...state.project,
            assets: state.project.assets.filter((item) => item.id !== panoramaAssetId),
            panoramaAssetId: null,
          },
        };
      }),
    removeImportedAsset: (assetId) =>
      commitMutation((state) => {
        const targetAsset = state.project.assets.find((item) => item.id === assetId);
        if (!targetAsset || targetAsset.sourceType !== "model") return state;

        removePersistedLocalModelAsset(assetId);

        const removedObjectIds = new Set(
          state.project.objects.filter((item) => item.assetRefId === assetId).map((item) => item.id)
        );
        const nextObjects = state.project.objects.filter((item) => item.assetRefId !== assetId);
        const nextCameras = state.project.cameras.map((camera) =>
          camera.targetObjectId && removedObjectIds.has(camera.targetObjectId)
            ? {
                ...camera,
                targetMode: "manual" as const,
                targetObjectId: null,
              }
            : camera
        );
        const selectedObjectIds = state.selectedObjectIds.filter((id) => !removedObjectIds.has(id));
        const selectedObjectId =
          state.selectedObjectId && removedObjectIds.has(state.selectedObjectId)
            ? selectedObjectIds[selectedObjectIds.length - 1] ?? null
            : state.selectedObjectId;

        return {
          ...state,
          selectedObjectId,
          selectedObjectIds,
          selectedCrowdId: null,
          project: {
            ...state.project,
            assets: state.project.assets.filter((item) => item.id !== assetId),
            objects: nextObjects,
            cameras: nextCameras,
          },
        };
      }),
    updateObjectTransform: (id, patch) =>
      commitMutation((state) => {
        const currentObject = state.project.objects.find((item) => item.id === id);
        const nextTransform = currentObject
          ? {
              position: patch.position ?? currentObject.transform.position,
              rotation: patch.rotation ?? currentObject.transform.rotation,
              scale: patch.scale ?? currentObject.transform.scale,
            }
          : null;
        const nextObject = currentObject && nextTransform ? { ...currentObject, transform: nextTransform } : null;

        return {
          ...state,
          project: {
            ...state.project,
            objects: updateObjectById(state.project.objects, id, (item) => ({
              ...item,
              transform: {
                position: patch.position ?? item.transform.position,
                rotation: patch.rotation ?? item.transform.rotation,
                scale: patch.scale ?? item.transform.scale,
              },
            })),
            cameras:
              currentObject?.kind === "camera" && currentObject.linkedCameraId && nextTransform
                ? state.project.cameras.map((camera) =>
                    camera.id === currentObject.linkedCameraId
                      ? {
                          ...camera,
                          transform: nextTransform,
                        }
                      : camera
                  )
                : nextObject
                  ? refreshCamerasFocusedOnObject(state.project.cameras, nextObject)
                  : state.project.cameras,
          },
        };
      }),
    updateObjectPivot: (id, pivot) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: updateObjectById(state.project.objects, id, (item) => ({ ...item, pivot })),
        },
      })),
    setObjectParent: (id, parentId) =>
      commitMutation((state) => {
        const validParentId =
          parentId && parentId !== id && state.project.objects.some((item) => item.id === parentId)
            ? parentId
            : null;
        const descendants = new Set<string>([id]);
        let changed = true;
        while (changed) {
          changed = false;
          state.project.objects.forEach((item) => {
            if (item.parentId && descendants.has(item.parentId) && !descendants.has(item.id)) {
              descendants.add(item.id);
              changed = true;
            }
          });
        }
        if (validParentId && descendants.has(validParentId)) return state;
        return {
          ...state,
          project: {
            ...state.project,
            objects: updateObjectById(state.project.objects, id, (item) => ({ ...item, parentId: validParentId })),
          },
        };
      }),
    updateCrowdTransform: (crowdId, patch) =>
      commitMutation((state) => {
        const nextTransformState = applyCrowdTransformPatch(state.project.objects, crowdId, patch);
        if (nextTransformState.changedObjectIds.length === 0) return state;

        return {
          ...state,
          project: {
            ...state.project,
            objects: nextTransformState.objects,
            cameras: refreshCamerasFocusedOnObjects(
              state.project.cameras,
              nextTransformState.objects,
              nextTransformState.changedObjectIds
            ),
          },
        };
      }),
    updateObjectName: (id, name) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: updateObjectById(state.project.objects, id, (item) => ({
            ...item,
            name,
          })),
        },
      })),
    updateCrowdLabel: (crowdId, label) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: state.project.objects.map((item) =>
            item.kind === "character" && item.crowdId === crowdId
              ? {
                  ...item,
                  crowdLabel: label,
                }
              : item
          ),
        },
      })),
    updateObjectColor: (id, color) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: updateObjectById(state.project.objects, id, (item) => ({
            ...item,
            color,
          })),
        },
      })),
    updateObjectMaterial: (id, material) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: updateObjectById(state.project.objects, id, (item) => ({ ...item, material })),
        },
      })),
    updateObjectGeometryAnchor: (id, geometryAnchor) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: updateObjectById(state.project.objects, id, (item) => ({ ...item, geometryAnchor })),
        },
      })),
    updateObjectGeometrySize: (id, geometrySize) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: updateObjectById(state.project.objects, id, (item) => ({ ...item, geometrySize })),
        },
      })),
    setObjectAssemblyMetadata: (id, metadata) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: updateObjectById(state.project.objects, id, (item) => ({ ...item, ...metadata })),
        },
      })),
    updateCrowdColor: (crowdId, color) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: state.project.objects.map((item) =>
            item.kind === "character" && item.crowdId === crowdId
              ? {
                  ...item,
                  color,
                }
              : item
          ),
        },
      })),
    updateCharacterBodyType: (id, bodyType) =>
      commitMutation((state) => {
        const normalizedBodyType = normalizeBodyType(bodyType);
        const currentObject = state.project.objects.find((item) => item.id === id);
        const nextObject =
          currentObject?.kind === "character"
            ? {
                ...currentObject,
                bodyType: normalizedBodyType,
              }
            : null;

        return {
          ...state,
          project: {
            ...state.project,
            objects: updateObjectById(state.project.objects, id, (item) =>
              item.kind === "character"
                ? {
                    ...item,
                    bodyType: normalizedBodyType,
                  }
                : item
            ),
            cameras: nextObject ? refreshCamerasFocusedOnObject(state.project.cameras, nextObject) : state.project.cameras,
          },
        };
      }),
    updateUniformScale: (id, scale) =>
      commitMutation((state) => {
        const currentObject = state.project.objects.find((item) => item.id === id);
        const nextObject = currentObject
          ? {
              ...currentObject,
              transform: {
                ...currentObject.transform,
                scale: [scale, scale, scale] as [number, number, number],
              },
            }
          : null;

        return {
          ...state,
          project: {
            ...state.project,
            objects: updateObjectById(state.project.objects, id, (item) => ({
              ...item,
              transform: {
                ...item.transform,
                scale: [scale, scale, scale],
              },
            })),
            cameras: nextObject ? refreshCamerasFocusedOnObject(state.project.cameras, nextObject) : state.project.cameras,
          },
        };
      }),
    updateCrowdUniformScale: (crowdId, scale) =>
      commitMutation((state) => {
        const nextTransformState = applyCrowdTransformPatch(state.project.objects, crowdId, {
          scale: [scale, scale, scale],
        });
        if (nextTransformState.changedObjectIds.length === 0) return state;

        return {
          ...state,
          project: {
            ...state.project,
            objects: nextTransformState.objects,
            cameras: refreshCamerasFocusedOnObjects(
              state.project.cameras,
              nextTransformState.objects,
              nextTransformState.changedObjectIds
            ),
          },
        };
      }),
    addImportedAsset: (input) =>
      commitMutation((state) => {
        const assetId = getNextSequentialId(
          state.project.assets.map((item) => item.id),
          "asset_",
          state.project.assets.length + 1
        );
        const nextAsset = {
          id: assetId,
          kind: input.kind,
          sourceType: input.kind === "panorama" ? "image" : "model",
          fileName: input.fileName,
          name: input.name,
          url: input.url,
          assetSource: input.kind === "panorama" ? undefined : (input.assetSource ?? "local"),
          projectionMode: input.projectionMode,
          animated: input.animated,
        } satisfies DirectorAssetRef;

        if (input.kind === "panorama") {
          return {
            ...state,
            directorInspectorMode: "scene",
            selectedObjectId: null,
            selectedObjectIds: [],
            selectedCrowdId: null,
            project: {
              ...state.project,
              assets: [...state.project.assets, nextAsset],
              panoramaAssetId: assetId,
            },
          };
        }

        if (input.addToScene === false) {
          persistLocalModelAsset(nextAsset);

          return {
            ...state,
            project: {
              ...state.project,
              assets: [...state.project.assets, nextAsset],
            },
          };
        }

        const nextObject = createSceneObjectFromAsset(nextAsset, state.project.objects);

        return {
          ...state,
          selectedObjectId: nextObject.id,
          selectedObjectIds: [nextObject.id],
          selectedCrowdId: null,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            assets: [...state.project.assets, nextAsset],
            objects: [...state.project.objects, nextObject],
          },
        };
      }),
    attachImportedAssetToCharacter: (id, input) => {
      let attached = false;

      commitMutation((state) => {
        const character = state.project.objects.find((item) => item.id === id && item.kind === "character");
        if (!character) return state;

        const assetId = getNextSequentialId(
          state.project.assets.map((item) => item.id),
          "asset_",
          state.project.assets.length + 1
        );
        const asset = {
          id: assetId,
          kind: "character" as const,
          sourceType: "model" as const,
          fileName: input.fileName,
          name: input.name,
          url: input.url,
          assetSource: input.assetSource ?? "local",
          animated: input.animated,
        } satisfies DirectorAssetRef;
        attached = true;

        return {
          ...state,
          selectedObjectId: id,
          selectedObjectIds: [id],
          selectedCrowdId: null,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            assets: [...state.project.assets, asset],
            objects: updateObjectById(state.project.objects, id, (item) => ({
              ...item,
              assetRefId: assetId,
            })),
          },
        };
      });

      return attached;
    },
    clearCharacterAsset: (id) =>
      commitMutation((state) => {
        const character = state.project.objects.find((item) => item.id === id && item.kind === "character");
        if (!character?.assetRefId) return state;
        const detachedAssetId = character.assetRefId;
        const detachedAsset = state.project.assets.find((asset) => asset.id === detachedAssetId);
        const usedByAnotherObject = state.project.objects.some(
          (item) => item.id !== id && item.assetRefId === detachedAssetId
        );
        const shouldRemoveDetachedAsset =
          !usedByAnotherObject && Boolean(detachedAsset?.url.startsWith("/api/generated-animations/"));
        return {
          ...state,
          project: {
            ...state.project,
            assets: shouldRemoveDetachedAsset
              ? state.project.assets.filter((asset) => asset.id !== detachedAssetId)
              : state.project.assets,
            objects: updateObjectById(state.project.objects, id, (item) => ({
              ...item,
              assetRefId: undefined,
              characterRig: item.characterRig ?? { rigType: "ue4-mannequin", posePresetId: "stand", controls: {} },
            })),
          },
        };
      }),
    addObjectFromAsset: (assetId) => {
      let nextObjectId: string | null = null;

      commitMutation((state) => {
        const asset = state.project.assets.find((item) => item.id === assetId);
        if (!asset || asset.sourceType !== "model" || asset.kind === "panorama") return state;

        const nextObject = createSceneObjectFromAsset(asset, state.project.objects);
        nextObjectId = nextObject.id;

        return {
          ...state,
          selectedObjectId: nextObject.id,
          selectedObjectIds: [nextObject.id],
          selectedCrowdId: null,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            objects: [...state.project.objects, nextObject],
          },
        };
      });

      return nextObjectId;
    },
    addPresetCharacter: (bodyType = DEFAULT_CHARACTER_BODY_TYPE) =>
      commitMutation((state) => {
        const presetCharacterCount = state.project.objects.filter(
          (item) => item.kind === "character" && item.id.startsWith("char_preset_")
        ).length;
        const presetCharacterIndex = presetCharacterCount + 1;
        const row = Math.floor((presetCharacterIndex - 1) / 4);
        const x = getAddedModelColumnOffset(presetCharacterIndex - row * 4);
        const z = row * 0.8;
        const nextObject = buildPresetCharacterObject(state, bodyType, [x, 0, z]);

        return {
          ...state,
          selectedObjectId: nextObject.id,
          selectedObjectIds: [nextObject.id],
          selectedCrowdId: null,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            objects: [...state.project.objects, nextObject],
          },
        };
      }),
    addCrowdCharacters: ({ bodyType = DEFAULT_CHARACTER_BODY_TYPE, rows, columns, spacing }) => {
      const createdIds: string[] = [];

      commitMutation((state) => {
        const positions = getCrowdCharacterPositions(rows, columns, spacing);
        const offset = getCrowdCharacterOffset(state.project.objects, spacing);
        const nextObjects = [...state.project.objects];
        const crowdLabel = formatCrowdLabel(rows, columns);
        const crowdId = getNextCrowdId(state.project.objects);

        positions.forEach((position) => {
          const nextState = {
            ...state,
            project: {
              ...state.project,
              objects: nextObjects,
            },
          } as DirectorRuntimeState;
          const nextObject = buildPresetCharacterObject(nextState, bodyType, [
            Number((position[0] + offset[0]).toFixed(4)),
            Number((position[1] + offset[1]).toFixed(4)),
            Number((position[2] + offset[2]).toFixed(4)),
          ], {
            crowdId,
            crowdLabel,
          });
          nextObjects.push(nextObject);
          createdIds.push(nextObject.id);
        });

        if (!createdIds.length) return state;

        return {
          ...state,
          selectedObjectId: createdIds[createdIds.length - 1] ?? null,
          selectedObjectIds: createdIds,
          selectedCrowdId: crowdId,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            objects: nextObjects,
          },
        };
      });

      return createdIds;
    },
    addGeometryPrimitive: (geometryType) =>
      commitMutation((state) => {
        const geometryObjects = state.project.objects.filter((item) => item.kind === "prop" && item.geometryType);
        const geometryIndex = geometryObjects.length + 1;
        const sameTypeCount = geometryObjects.filter((item) => item.geometryType === geometryType).length;
        const row = Math.floor((geometryIndex - 1) / 4);
        const column = (geometryIndex - 1) % 4;
        const x = column * 1.15 - 1.725;
        const z = row * 0.75 + 1.15;
        const label = getGeometryPrimitiveLabel(geometryType);
        const objectId = getNextSequentialId(
          state.project.objects.map((item) => item.id),
          `geo_${geometryType}_`,
          geometryIndex
        );
        const nextObject: DirectorObject = {
          id: objectId,
          name: sameTypeCount === 0 ? label : `${label}${String(sameTypeCount + 1).padStart(2, "0")}`,
          kind: "prop",
          visible: true,
          locked: false,
          geometryType,
          color: GEOMETRY_PRIMITIVE_COLOR,
          transform: createTransform([x, 0, z]),
        };

        return {
          ...state,
          selectedObjectId: objectId,
          selectedObjectIds: [objectId],
          selectedCrowdId: null,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            objects: [...state.project.objects, nextObject],
          },
        };
      }),
    addGroup: (input = {}) => {
      let createdGroupId = "";
      commitMutation((state) => {
        const groupIndex = state.project.objects.filter((item) => item.kind === "group").length + 1;
        const groupId = getNextSequentialId(
          state.project.objects.map((item) => item.id),
          "group_",
          groupIndex
        );
        createdGroupId = groupId;
        const group: DirectorObject = {
          id: groupId,
          name: input.name?.trim() || `组合${String(groupIndex).padStart(2, "0")}`,
          kind: "group",
          visible: true,
          locked: false,
          parentId: input.parentId ?? null,
          pivot: input.pivot ?? [0, 0, 0],
          assemblySelectionMode: input.assemblySelectionMode,
          transform: {
            position: input.transform?.position ?? [0, 0, 0],
            rotation: input.transform?.rotation ?? [0, 0, 0],
            scale: input.transform?.scale ?? [1, 1, 1],
          },
        };
        return {
          ...state,
          selectedObjectId: groupId,
          selectedObjectIds: [groupId],
          selectedCrowdId: null,
          directorInspectorMode: "auto",
          project: { ...state.project, objects: [...state.project.objects, group] },
        };
      });
      return createdGroupId;
    },
    groupObjects: (objectIds, name) => {
      let createdGroupId: string | null = null;
      commitMutation((state) => {
        const requestedIds = objectIds?.length ? objectIds : getOrderedSelectedObjectIds(state);
        const selected = state.project.objects.filter(
          (item) => requestedIds.includes(item.id) && item.kind !== "camera" && !item.parentId
        );
        if (!selected.length) return state;
        const center: [number, number, number] = [0, 1, 2].map((axis) =>
          Number((selected.reduce((sum, item) => sum + item.transform.position[axis], 0) / selected.length).toFixed(4))
        ) as [number, number, number];
        const groupId = getNextSequentialId(
          state.project.objects.map((item) => item.id),
          "group_",
          state.project.objects.filter((item) => item.kind === "group").length + 1
        );
        createdGroupId = groupId;
        const group: DirectorObject = {
          id: groupId,
          name: name?.trim() || `组合${String(state.project.objects.filter((item) => item.kind === "group").length + 1).padStart(2, "0")}`,
          kind: "group",
          visible: true,
          locked: false,
          transform: createTransform(center),
          pivot: [0, 0, 0],
          assemblyRootId: groupId,
          assemblySelectionMode: "whole",
        };
        const selectedIds = new Set(selected.map((item) => item.id));
        const objects = state.project.objects.map((item) =>
          selectedIds.has(item.id)
            ? {
                ...item,
                parentId: groupId,
                assemblyRootId: groupId,
                transform: {
                  ...item.transform,
                  position: item.transform.position.map((value, axis) => Number((value - center[axis]).toFixed(4))) as [number, number, number],
                },
              }
            : item
        );
        return {
          ...state,
          selectedObjectId: groupId,
          selectedObjectIds: [groupId],
          selectedCrowdId: null,
          directorInspectorMode: "auto",
          project: { ...state.project, objects: [...objects, group] },
        };
      });
      return createdGroupId;
    },
    setObjectAnimationTrack: (id, track) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: updateObjectById(state.project.objects, id, (item) => ({
            ...item,
            objectAnimationTrack: track ?? undefined,
          })),
        },
      })),
    addAnimationSequence: (sequence) => {
      let sequenceId = sequence.id;
      commitMutation((state) => {
        const existingIds = state.project.animationSequences?.map((item) => item.id) ?? [];
        sequenceId = sequence.id && !existingIds.includes(sequence.id)
          ? sequence.id
          : getNextSequentialId(existingIds, "sequence_", existingIds.length + 1);
        const normalized = normalizeAnimationSequence({ ...sequence, id: sequenceId }, state.project.objects, state.project.cameras);
        if (!normalized) return state;
        return {
          ...state,
          project: {
            ...state.project,
            animationSequences: [...(state.project.animationSequences ?? []), normalized],
            activeAnimationSequenceId: sequenceId,
          },
        };
      });
      return sequenceId;
    },
    updateAnimationSequence: (id, patch) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          animationSequences: (state.project.animationSequences ?? []).map((sequence) => {
            if (sequence.id !== id) return sequence;
            return normalizeAnimationSequence({ ...sequence, ...patch, id }, state.project.objects, state.project.cameras) ?? sequence;
          }),
        },
      })),
    deleteAnimationSequence: (id) => {
      resetAnimationSequenceRuntime();
      commitMutation((state) => {
        const animationSequences = (state.project.animationSequences ?? []).filter((sequence) => sequence.id !== id);
        return {
          ...state,
          project: {
            ...state.project,
            animationSequences,
            activeAnimationSequenceId:
              state.project.activeAnimationSequenceId === id
                ? animationSequences[0]?.id ?? null
                : state.project.activeAnimationSequenceId ?? null,
          },
        };
      });
    },
    setActiveAnimationSequence: (id) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          activeAnimationSequenceId:
            id && (state.project.animationSequences ?? []).some((sequence) => sequence.id === id) ? id : null,
        },
      })),
    replaceAnimationSequences: (sequences) => {
      resetAnimationSequenceRuntime();
      commitMutation((state) => {
        const animationSequences = sequences
          .map((sequence) => normalizeAnimationSequence(sequence, state.project.objects, state.project.cameras))
          .filter((sequence): sequence is DirectorAnimationSequence => Boolean(sequence));
        return {
          ...state,
          project: {
            ...state.project,
            animationSequences,
            activeAnimationSequenceId: animationSequences[0]?.id ?? null,
          },
        };
      });
    },
    addCameraShot: (snapshot) => {
      let nextCameraId = "";

      commitMutation((state) => {
        const cameraIndex = state.project.cameras.length + 1;
        const cameraId = getNextSequentialId(
          state.project.cameras.map((item) => item.id),
          "cam_",
          cameraIndex
        );
        const objectId = getNextSequentialId(
          state.project.objects.map((item) => item.id),
          "cam_object_",
          cameraIndex
        );
        nextCameraId = cameraId;
        const transform = createTransform(
          snapshot ? getCameraRigPositionFromViewSnapshot(snapshot) : [cameraIndex * 1.2, 2.2, 9]
        );
        const nextCamera: DirectorCameraShot = {
          id: cameraId,
          name: formatSceneItemName("机位", cameraIndex),
          fov: snapshot?.fov ?? 50,
          transform,
          targetMode: "manual",
          target: snapshot?.target ?? [0, 1.2, 0],
          lastCaptureUrl: null,
          captures: [],
        };
        const nextCameraObject: DirectorObject = {
          id: objectId,
          name: nextCamera.name,
          kind: "camera",
          visible: true,
          locked: false,
          linkedCameraId: cameraId,
          transform,
        };

        return {
          ...state,
          selectedObjectId: objectId,
          selectedObjectIds: [objectId],
          selectedCrowdId: null,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            cameras: [...state.project.cameras, nextCamera],
            activeCameraId: cameraId,
            objects: [...state.project.objects, nextCameraObject],
          },
        };
      });

      return nextCameraId;
    },
    addCameraAnimation: ({ cameraId, name, keyframes }) => {
      let nextAnimationId = "";

      commitMutation((state) => {
        const camera = state.project.cameras.find((item) => item.id === cameraId);
        if (!camera || keyframes.length < 2) return state;

        const animationIndex = state.project.cameraAnimations.length + 1;
        const animationId = getNextSequentialId(
          state.project.cameraAnimations.map((item) => item.id),
          "cam_anim_",
          animationIndex
        );
        nextAnimationId = animationId;

        return {
          ...state,
          project: {
            ...state.project,
            cameraAnimations: [
              ...state.project.cameraAnimations,
              {
                id: animationId,
                name: name ?? `${camera.name}-轨迹${String(animationIndex).padStart(2, "0")}`,
                cameraId,
                keyframes: cloneJsonValue(keyframes),
              },
            ],
          },
        };
      });

      return nextAnimationId;
    },
    deleteCameraAnimation: (animationId) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          cameraAnimations: state.project.cameraAnimations.filter((animation) => animation.id !== animationId),
        },
      })),
    replaceCameraAnimations: (animations) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          cameraAnimations: cloneJsonValue(animations),
        },
      })),
    deleteSelectedObject: () =>
      commitMutation((state) => {
        const selectedObjectIds = getOrderedSelectedObjectIds(state);
        if (!selectedObjectIds.length) return state;

        const selectedObjectIdSet = new Set(selectedObjectIds);
        let foundDescendant = true;
        while (foundDescendant) {
          foundDescendant = false;
          state.project.objects.forEach((item) => {
            if (item.parentId && selectedObjectIdSet.has(item.parentId) && !selectedObjectIdSet.has(item.id)) {
              selectedObjectIdSet.add(item.id);
              foundDescendant = true;
            }
          });
        }
        const selectedObjects = state.project.objects.filter((item) => selectedObjectIdSet.has(item.id));
        if (!selectedObjects.length) {
          return {
            ...state,
            selectedObjectId: null,
            selectedObjectIds: [],
          };
        }

        const linkedCameraIds = new Set(
          selectedObjects
            .filter((item) => item.kind === "camera" && item.linkedCameraId)
            .map((item) => item.linkedCameraId)
        );
        const nextCameras = linkedCameraIds.size
          ? state.project.cameras.filter((camera) => !linkedCameraIds.has(camera.id))
          : state.project.cameras;
        const nextCameraAnimations = linkedCameraIds.size
          ? state.project.cameraAnimations.filter((animation) => !linkedCameraIds.has(animation.cameraId))
          : state.project.cameraAnimations;
        const nextFocusedCameras = nextCameras.map((camera) =>
          camera.targetObjectId && selectedObjectIdSet.has(camera.targetObjectId)
            ? {
                ...camera,
                targetMode: "manual" as const,
                targetObjectId: null,
              }
            : camera
        );
        const nextActiveCameraId =
          state.project.activeCameraId && linkedCameraIds.has(state.project.activeCameraId)
            ? nextFocusedCameras[0]?.id ?? null
            : state.project.activeCameraId;
        const nextObjects = state.project.objects.filter((item) => !selectedObjectIdSet.has(item.id));
        const assetsById = new Map(state.project.assets.map((item) => [item.id, item]));
        const remainingAssetRefIds = new Set(
          nextObjects.map((item) => item.assetRefId).filter((assetRefId): assetRefId is string => Boolean(assetRefId))
        );
        const removedAssetRefIds = new Set(
          selectedObjects
            .map((item) => item.assetRefId)
            .filter(
              (assetRefId): assetRefId is string => {
                if (typeof assetRefId !== "string" || remainingAssetRefIds.has(assetRefId)) return false;
                return assetsById.has(assetRefId);
              }
            )
        );
        removedAssetRefIds.forEach(removePersistedLocalModelAsset);

        return {
          ...state,
          selectedObjectId: null,
          selectedObjectIds: [],
          selectedCrowdId: null,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            assets: state.project.assets.filter((item) => !removedAssetRefIds.has(item.id)),
            objects: nextObjects,
            cameras: nextFocusedCameras,
            cameraAnimations: nextCameraAnimations,
            characterMotionClips: (state.project.characterMotionClips ?? []).filter((clip) =>
              nextObjects.some((object) => object.kind === "character" && object.id === clip.characterId)
            ),
            activeCameraId: nextActiveCameraId,
          },
        };
      }),
    toggleObjectVisible: (id) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: updateObjectById(state.project.objects, id, (item) => ({
            ...item,
            visible: !item.visible,
          })),
        },
      })),
    toggleObjectLocked: (id) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: updateObjectById(state.project.objects, id, (item) => ({
            ...item,
            locked: !item.locked,
          })),
        },
      })),
    applyPosePreset: (id, presetId) =>
      commitMutation((state) => {
        const preset = MANNEQUIN_POSE_PRESETS.find((item) => item.id === presetId);

        return {
          ...state,
          project: {
            ...state.project,
            objects: updateObjectById(state.project.objects, id, (item) => ({
              ...item,
              characterRig: item.characterRig
                ? {
                    ...item.characterRig,
                    posePresetId: presetId,
                    controls: preset ? { ...preset.controls } : item.characterRig.controls,
                  }
                : item.characterRig,
            })),
          },
        };
      }),
    applyCrowdPosePreset: (crowdId, presetId) =>
      commitMutation((state) => {
        const preset = MANNEQUIN_POSE_PRESETS.find((item) => item.id === presetId);

        return {
          ...state,
          project: {
            ...state.project,
            objects: state.project.objects.map((item) =>
              item.kind === "character" && item.crowdId === crowdId
                ? {
                    ...item,
                    characterRig: item.characterRig
                      ? {
                          ...item.characterRig,
                          posePresetId: presetId,
                          controls: preset ? { ...preset.controls } : item.characterRig.controls,
                        }
                      : item.characterRig,
                  }
                : item
            ),
          },
        };
      }),
    updatePoseControl: (id, key, value) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: updateObjectById(state.project.objects, id, (item) => ({
            ...item,
            characterRig: item.characterRig
              ? {
                  ...item.characterRig,
                  posePresetId: null,
                  controls: {
                    ...withoutMediaPoseControls(item.characterRig.controls),
                    [key]: value,
                  },
                }
              : item.characterRig,
            })),
        },
      })),
    updatePoseControls: (id, controls) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: updateObjectById(state.project.objects, id, (item) => ({
            ...item,
            characterRig: item.characterRig
              ? {
                  ...item.characterRig,
                  posePresetId: null,
                  controls: {
                    ...withoutMediaPoseControls(item.characterRig.controls),
                    ...controls,
                  },
                }
              : item.characterRig,
          })),
        },
      })),
    replacePoseControls: (id, controls) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: updateObjectById(state.project.objects, id, (item) => ({
            ...item,
            characterRig: item.characterRig
              ? {
                  ...item.characterRig,
                  posePresetId: null,
                  controls: cloneJsonValue(controls),
                }
              : item.characterRig,
          })),
        },
      })),
    updateCrowdPoseControl: (crowdId, key, value) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: state.project.objects.map((item) =>
            item.kind === "character" && item.crowdId === crowdId
              ? {
                  ...item,
                  characterRig: item.characterRig
                    ? {
                        ...item.characterRig,
                        posePresetId: null,
                        controls: {
                          ...item.characterRig.controls,
                          [key]: value,
                        },
                      }
                    : item.characterRig,
                }
              : item
          ),
        },
      })),
    setCharacterActionTrack: (id, track) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: updateObjectById(state.project.objects, id, (item) =>
            item.kind === "character" ? { ...item, characterActionTrack: track ? cloneJsonValue(track) : undefined } : item
          ),
        },
      })),
    setCrowdCharacterActionTrack: (crowdId, track) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: state.project.objects.map((item) =>
            item.kind === "character" && item.crowdId === crowdId
              ? { ...item, characterActionTrack: track ? cloneJsonValue(track) : undefined }
              : item
          ),
        },
      })),
    addCharacterMotionClip: (input) => {
      let clipId = "";

      commitMutation((state) => {
        const clips = state.project.characterMotionClips ?? [];
        clipId = getNextSequentialId(
          clips.map((clip) => clip.id),
          "mocap_",
          clips.length + 1
        );
        const clip: CharacterMotionClip = {
          ...cloneJsonValue(input),
          id: clipId,
          duration: Math.max(input.duration, 0.1),
        };
        return {
          ...state,
          project: {
            ...state.project,
            characterMotionClips: [...clips, clip],
          },
        };
      });

      return clipId;
    },
    deleteCharacterMotionClip: (clipId) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          characterMotionClips: (state.project.characterMotionClips ?? []).filter((clip) => clip.id !== clipId),
          objects: state.project.objects.map((object) =>
            object.characterActionTrack?.motionClipId === clipId
              ? { ...object, characterActionTrack: undefined }
              : object
          ),
        },
      })),
    setScenePlan: (plan) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          scenePlan: plan ? cloneJsonValue(plan) : null,
        },
      })),
    setActiveCamera: (cameraId) =>
      commitUiMutation((state) => {
        const selectedObjectId =
          state.project.objects.find((item) => item.kind === "camera" && item.linkedCameraId === cameraId)?.id ??
          null;

        return {
          ...state,
          project: {
            ...state.project,
            activeCameraId: cameraId,
          },
          selectedObjectId,
          selectedObjectIds: selectedObjectId ? [selectedObjectId] : [],
          selectedCrowdId: null,
        };
      }),
    addCameraCaptures: (cameraId, dataUrls) =>
      commitMutation((state) => {
        if (dataUrls.length === 0) return state;

        const targetCameraId = cameraId ?? state.project.activeCameraId ?? state.project.cameras[0]?.id ?? null;
        if (!targetCameraId) return state;

        let updated = false;
        const cameras = state.project.cameras.map((camera) => {
          if (camera.id !== targetCameraId) return camera;

          updated = true;
          const nextCaptures = buildCameraCaptures(camera, dataUrls);

          return {
            ...camera,
            lastCaptureUrl: nextCaptures[nextCaptures.length - 1]?.dataUrl ?? camera.lastCaptureUrl ?? null,
            captures: [...(camera.captures ?? []), ...nextCaptures],
          };
        });

        if (!updated) return state;

        return {
          ...state,
          project: {
            ...state.project,
            cameras,
          },
        };
      }),
    updateCamera: (cameraId, patch) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          cameras: state.project.cameras.map((item) =>
            item.id === cameraId
              ? {
                  ...item,
                  ...patch,
                  transform: patch.transform ?? item.transform,
                  target: patch.target ?? item.target,
                }
              : item
          ),
            objects: state.project.objects.map((item) =>
              item.kind === "camera" && item.linkedCameraId === cameraId
                ? {
                    ...item,
                    name: typeof patch.name === "string" ? patch.name : item.name,
                    transform: patch.transform ?? item.transform,
                  }
                : item
          ),
        },
      })),
    updateCameraForPlayback: (cameraId, patch) =>
      commitMutation(
        (state) => ({
          ...state,
          project: {
            ...state.project,
            cameras: state.project.cameras.map((item) =>
              item.id === cameraId
                ? {
                    ...item,
                    ...patch,
                    transform: patch.transform ?? item.transform,
                    target: patch.target ?? item.target,
                  }
                : item
            ),
            objects: state.project.objects.map((item) =>
              item.kind === "camera" && item.linkedCameraId === cameraId
                ? {
                    ...item,
                    name: typeof patch.name === "string" ? patch.name : item.name,
                    transform: patch.transform ?? item.transform,
                  }
                : item
            ),
          },
        }),
        { trackUndo: false, persist: false }
      ),
    copySelectedObjects: () => {
      const currentState = get() as DirectorRuntimeState;
      const clipboard = buildClipboardEntries(currentState);
      set({
        ...currentState,
        clipboard,
        clipboardPasteCount: 0,
      });
    },
    pasteClipboardObjects: () => commitMutation((state) => pasteClipboardEntries(state)),
    undo: () => {
      const currentState = get() as DirectorRuntimeState;
      const previousState = currentState.undoStack[currentState.undoStack.length - 1];
      if (!previousState) return;

      const runtimeState = createRuntimeStateFromPersistedState(previousState);
      set({
        ...runtimeState,
        clipboard: currentState.clipboard,
        clipboardPasteCount: currentState.clipboardPasteCount,
        undoStack: currentState.undoStack.slice(0, -1),
      });
      writePersistedDirectorState(previousState);
    },
    openScopedScene: (scopeId) => {
      const currentState = get() as DirectorRuntimeState;
      setDirectorScenePersistenceScopeId(scopeId);
      const snapshot = createInitialDirectorState({
        includePersistedLocalAssets: true,
        includePersistedScene: true,
        persistenceScopeId: directorScenePersistenceScopeId,
      });
      const runtimeState = createRuntimeStateFromPersistedState(snapshot);

      set({
        ...runtimeState,
        clipboard: currentState.clipboard,
        clipboardPasteCount: currentState.clipboardPasteCount,
        undoStack: [],
      });
      writePersistedDirectorState(snapshot);
    },
    resetDirectorDesk: () => {
      resetObjectAnimationRuntime();
      resetAnimationSequenceRuntime();
      commitMutation((state) => ({
        ...state,
        ...DEFAULT_UI_STATE,
        project: createDefaultDirectorProject(),
        selectedObjectId: null,
        selectedObjectIds: [],
        selectedCrowdId: null,
        directorInspectorMode: "auto",
      }));
    },
    replaceProject: (project) => {
      resetObjectAnimationRuntime();
      resetAnimationSequenceRuntime();
      commitMutation((state) => ({
        ...state,
        poseEditMode: false,
        viewMode: "director",
        cameraMonitorCollapsed: false,
        project: migrateDirectorProject(cloneJsonValue(project)),
        selectedObjectId: null,
        selectedObjectIds: [],
        selectedCrowdId: null,
        directorInspectorMode: "auto",
      }));
    },
    saveLatestSnapshot: () => {
      writePersistedDirectorState(extractPersistedDirectorState(get() as DirectorRuntimeState));
    },
    restoreLatestSnapshot: () => {
      const snapshot = readPersistedDirectorState({ includePersistedLocalAssets: true, includePersistedScene: true });
      if (!snapshot) return;

      set({
        ...createRuntimeStateFromPersistedState(snapshot),
        clipboard: (get() as DirectorRuntimeState).clipboard,
        clipboardPasteCount: (get() as DirectorRuntimeState).clipboardPasteCount,
        undoStack: [],
      });
      writePersistedDirectorState(snapshot);
    },
  };
});
