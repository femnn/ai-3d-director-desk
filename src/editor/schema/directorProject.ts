export type ViewMode = "director" | "camera";
export type RightPanelKind = "scene" | "character" | "prop" | "camera";
export type DirectorObjectKind = "character" | "scene" | "prop" | "group" | "camera" | "panorama";
export const GEOMETRY_PRIMITIVE_OPTIONS = [
  { type: "box", label: "立方体" },
  { type: "rounded-box", label: "圆角盒" },
  { type: "sphere", label: "球体" },
  { type: "ellipsoid", label: "椭球体" },
  { type: "hemisphere", label: "半球" },
  { type: "capsule", label: "胶囊体" },
  { type: "cylinder", label: "圆柱体" },
  { type: "pipe", label: "管道" },
  { type: "disc", label: "圆盘" },
  { type: "plane", label: "平面" },
  { type: "plane-card", label: "竖直卡片" },
  { type: "wedge", label: "楔形" },
  { type: "torus", label: "环状体" },
  { type: "cone", label: "圆锥" },
  { type: "pyramid", label: "棱锥" },
] as const;
export type GeometryPrimitiveType = (typeof GEOMETRY_PRIMITIVE_OPTIONS)[number]["type"];
export const PROCEDURAL_FACTORY_OPTIONS = [
  { id: "crimson-transformer", label: "赤曜变形机甲" },
  { id: "train-station-car-chase", label: "火车站追车爆炸" },
  { id: "alien-park-abduction", label: "公园飞碟劫持" },
] as const;
export type ProceduralFactoryId = (typeof PROCEDURAL_FACTORY_OPTIONS)[number]["id"];
export interface DirectorProceduralFactorySettings {
  id: ProceduralFactoryId;
  parameters?: Record<string, string | number | boolean>;
}
export type CharacterRigType = "mannequin" | "ue4-mannequin" | "mixamo" | "vrm" | "custom-humanoid";
export type CharacterActionId =
  | "still"
  | "idle"
  | "sit"
  | "drink-tea"
  | "talk"
  | "walk"
  | "run"
  | "turn"
  | "look"
  | "wave"
  | "bow"
  | "think"
  | "reach"
  | "push"
  | "fight"
  | "dance"
  | "light-dance"
  | "phone";
export type CharacterActionPlaybackMode = "normal" | "camera-driven";
export type CharacterMotionSource = "built-in" | "video" | "mocap";
export type AnimationSequencePlaybackMode = "manual" | "recording" | "camera-motion";
export type CharacterBodyType =
  | "mannequin"
  | "female"
  | "broad"
  | "muscular"
  | "slim"
  | "teen"
  | "child"
  | "chibi";
export type DirectorAssetKind = "character" | "scene" | "prop" | "panorama";
export type DirectorAssetSource = "local" | "library";
export type PanoramaProjectionMode = "equirectangular" | "backdrop";

export interface DirectorTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface DirectorMaterialSettings {
  roughness?: number;
  metalness?: number;
  opacity?: number;
  emissive?: string;
  emissiveIntensity?: number;
}

export type ObjectAnimationPlaybackMode = "normal" | "recording-sync" | "camera-driven";
export type ObjectAnimationPathType = "linear" | "curve";

export interface ObjectAnimationKeyframe {
  time: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
}

export interface ObjectAnimationPath {
  type: ObjectAnimationPathType;
  closed: boolean;
  points: Array<[number, number, number]>;
  orientToPath?: boolean;
}

export interface ObjectAnimationTrack {
  id: string;
  name: string;
  duration: 5 | 10 | 15;
  loop: boolean;
  enabled: boolean;
  playbackMode: ObjectAnimationPlaybackMode;
  cameraId?: string | null;
  keyframes: ObjectAnimationKeyframe[];
  path?: ObjectAnimationPath;
}

export interface SceneSettings {
  scale: number;
  position: [number, number, number];
  rotation: [number, number, number];
  backgroundColor: string;
  panoramaYaw: number;
  panoramaRadius: number;
  showLabels: boolean;
  snapToGrid: boolean;
  showGrid: boolean;
  showGround: boolean;
  groundOpacity: number;
  groundHeight: number;
}

export interface CharacterRigState {
  rigType: CharacterRigType;
  posePresetId: string | null;
  controls: Record<string, number>;
}

export interface CharacterActionTrack {
  actionId: CharacterActionId;
  duration: number;
  loop: boolean;
  playbackMode: CharacterActionPlaybackMode;
  cameraId?: string | null;
  enabled: boolean;
  source?: CharacterMotionSource;
  motionClipId?: string | null;
}

export interface CharacterMotionFrame {
  time: number;
  controls: Record<string, number>;
  rootOffset?: [number, number, number];
  rootRotation?: [number, number, number];
}

export interface CharacterMotionClip {
  id: string;
  characterId: string;
  name: string;
  duration: number;
  frames: CharacterMotionFrame[];
}

export interface DirectorAnimationBinding {
  alias: string;
  objectId: string;
  objectName: string;
}

export interface DirectorAnimationTrackBase {
  id: string;
  name: string;
  binding: string;
  startTime: number;
  endTime: number;
  loop?: boolean;
  blendIn?: number;
  blendOut?: number;
}

export interface DirectorCharacterAnimationTrack extends DirectorAnimationTrackBase {
  type: "character";
  actionId?: CharacterActionId;
  motionClipId?: string | null;
}

export interface DirectorObjectAnimationTrack extends DirectorAnimationTrackBase {
  type: "object";
  keyframes: ObjectAnimationKeyframe[];
  path?: ObjectAnimationPath;
}

export type DirectorAnimationSequenceTrack =
  | DirectorCharacterAnimationTrack
  | DirectorObjectAnimationTrack;

export interface DirectorAnimationSequence {
  id: string;
  name: string;
  duration: 5 | 10 | 15;
  playbackMode: AnimationSequencePlaybackMode;
  loop: boolean;
  enabled: boolean;
  cameraId?: string | null;
  bindings: DirectorAnimationBinding[];
  tracks: DirectorAnimationSequenceTrack[];
}

export interface ScenePlan {
  intent: string;
  roles: Array<{
    name: string;
    purpose?: string;
    pose?: string;
    relation?: string;
  }>;
  composition?: string;
  environment?: string;
  assemblies?: Array<{
    name: string;
    parts: string[];
    motion?: string;
  }>;
  reviewNotes?: string;
}

export interface DirectorAssetRef {
  id: string;
  kind: DirectorAssetKind;
  sourceType: "model" | "image";
  fileName: string;
  name?: string;
  url: string;
  assetSource?: DirectorAssetSource;
  projectionMode?: PanoramaProjectionMode;
  animated?: boolean;
}

export interface DirectorObject {
  id: string;
  name: string;
  kind: DirectorObjectKind;
  visible: boolean;
  locked: boolean;
  transform: DirectorTransform;
  /** Transform is local to parentId. Pivot is also expressed in local coordinates. */
  parentId?: string | null;
  pivot?: [number, number, number];
  bodyType?: CharacterBodyType;
  color?: string;
  assetRefId?: string;
  geometryType?: GeometryPrimitiveType;
  /** Procedural parts use centered unit geometry so local component transforms stay predictable. */
  geometryAnchor?: "base" | "center";
  /** Visual mesh dimensions, intentionally separate from the node transform inherited by children. */
  geometrySize?: [number, number, number];
  material?: DirectorMaterialSettings;
  /** Allowlisted code-generated Three.js factory. Scene JSON can reference it but cannot execute code. */
  proceduralFactory?: DirectorProceduralFactorySettings;
  /** Viewport clicks resolve to this root so a generated vehicle or building moves as one assembly. */
  assemblyRootId?: string | null;
  assemblySelectionMode?: "whole" | "parts";
  crowdId?: string;
  crowdLabel?: string;
  linkedCameraId?: string | null;
  characterRig?: CharacterRigState;
  characterActionTrack?: CharacterActionTrack;
  objectAnimationTrack?: ObjectAnimationTrack;
}

export interface DirectorCameraCapture {
  id: string;
  index: number;
  name: string;
  dataUrl: string;
}

export interface DirectorCameraShot {
  id: string;
  name: string;
  fov: number;
  transform: DirectorTransform;
  targetMode: "manual" | "object";
  targetObjectId?: string | null;
  target: [number, number, number];
  lastCaptureUrl?: string | null;
  captures?: DirectorCameraCapture[];
}

export interface DirectorCameraAnimationKeyframe {
  time: number;
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export interface DirectorCameraAnimation {
  id: string;
  name: string;
  cameraId: string;
  keyframes: DirectorCameraAnimationKeyframe[];
}

export interface DirectorProject {
  version: 1;
  scene: SceneSettings;
  assets: DirectorAssetRef[];
  objects: DirectorObject[];
  cameras: DirectorCameraShot[];
  cameraAnimations: DirectorCameraAnimation[];
  characterMotionClips?: CharacterMotionClip[];
  animationSequences?: DirectorAnimationSequence[];
  activeAnimationSequenceId?: string | null;
  activeCameraId: string | null;
  panoramaAssetId: string | null;
  scenePlan?: ScenePlan | null;
}
