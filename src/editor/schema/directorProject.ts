export type ViewMode = "director" | "camera";
export type RightPanelKind = "scene" | "character" | "prop" | "camera";
export type DirectorObjectKind = "character" | "scene" | "prop" | "camera" | "panorama";
export const GEOMETRY_PRIMITIVE_OPTIONS = [
  { type: "box", label: "立方体" },
  { type: "sphere", label: "球体" },
  { type: "cylinder", label: "圆柱体" },
  { type: "torus", label: "环状体" },
  { type: "cone", label: "圆锥" },
  { type: "pyramid", label: "棱锥" },
] as const;
export type GeometryPrimitiveType = (typeof GEOMETRY_PRIMITIVE_OPTIONS)[number]["type"];
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
  | "phone";
export type CharacterActionPlaybackMode = "normal" | "camera-driven";
export type CharacterMotionSource = "built-in" | "video" | "mocap";
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
}

export interface CharacterMotionClip {
  id: string;
  characterId: string;
  name: string;
  duration: number;
  frames: CharacterMotionFrame[];
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
  bodyType?: CharacterBodyType;
  color?: string;
  assetRefId?: string;
  geometryType?: GeometryPrimitiveType;
  crowdId?: string;
  crowdLabel?: string;
  linkedCameraId?: string | null;
  characterRig?: CharacterRigState;
  characterActionTrack?: CharacterActionTrack;
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
  activeCameraId: string | null;
  panoramaAssetId: string | null;
  scenePlan?: ScenePlan | null;
}
