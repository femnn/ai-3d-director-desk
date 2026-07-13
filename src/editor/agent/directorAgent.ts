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
  DirectorCameraAnimation,
  DirectorObject,
  DirectorProject,
  DirectorTransform,
  GeometryPrimitiveType,
  PanoramaProjectionMode,
  ScenePlan,
} from "../schema/directorProject";
import { CHARACTER_ACTION_OPTIONS, MIN_CHARACTER_ACTION_DURATION } from "../animation/characterAnimation";
import type { PosePresetId } from "../schema/poseSchema";

type NumberTuple3 = [number, number, number];

export interface SceneScriptCharacter {
  id?: string;
  name?: string;
  type?: CharacterBodyType | "builtIn";
  bodyType?: CharacterBodyType;
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
  };
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
  camera?: SceneScriptCamera;
  cameras?: SceneScriptCamera[];
  activeCameraId?: string | null;
  cameraAnimations?: DirectorCameraAnimation[];
  panorama?: SceneScriptPanorama | null;
  scene?: Partial<DirectorProject["scene"]>;
  scenePlan?: ScenePlan | null;
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

function applyCharacterAction(id: string, action: SceneScriptCharacter["action"]) {
  if (!action) return;
  useDirectorStore.getState().setCharacterActionTrack(id, {
    actionId: normalizeActionId(action.id),
    duration: Math.max(Number(action.duration ?? MIN_CHARACTER_ACTION_DURATION), MIN_CHARACTER_ACTION_DURATION),
    loop: true,
    playbackMode: action.playbackMode === "camera-driven" ? "camera-driven" : "normal",
    cameraId: typeof action.cameraId === "string" ? action.cameraId : null,
    enabled: action.enabled !== false,
  });
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
    cameraCount: project.cameras.length,
    nextStep: missingRoles.length ? "补充缺失角色后再次截图检查构图" : "查看截图，按构图与道具关系提交修正命令",
  };
}

async function captureScenePlanReview() {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
  const captures = await requestViewportCapture({ preset: "current", source: "capture-panel" });
  return captures[0]?.dataUrl ?? null;
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
  nextState.updateObjectTransform(character.id, getTransformPatch(input, character.transform));

  const poseId = normalizePoseId(input.pose);
  if (poseId) nextState.applyPosePreset(character.id, poseId);
  const poseControls = normalizePoseControls(input.poseControls);
  if (poseControls) nextState.replacePoseControls(character.id, poseControls);
  applyCharacterAction(character.id, input.action);

  return { id: character.id };
}

export function updateCharacter(input: SceneScriptCharacter & { id?: string; name?: string }) {
  const target = findObject(input.id ?? input.name, "character");
  if (!target) throw new Error("Character not found");

  const store = useDirectorStore.getState();
  if (input.name && input.name !== target.name) store.updateObjectName(target.id, input.name);
  if (input.bodyType || input.type) store.updateCharacterBodyType(target.id, normalizeBodyType(input.bodyType ?? input.type));
  store.updateObjectTransform(target.id, getTransformPatch(input, target.transform));

  const poseId = normalizePoseId(input.pose);
  if (poseId) store.applyPosePreset(target.id, poseId);
  const poseControls = normalizePoseControls(input.poseControls);
  if (poseControls) store.replacePoseControls(target.id, poseControls);
  applyCharacterAction(target.id, input.action);

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
  nextState.updateObjectTransform(prop.id, {
    position: toTuple3(input.position, prop.transform.position),
    rotation: normalizeRotation(input, prop.transform.rotation),
    scale: toScaleTuple(input.scale, preset?.scale ?? prop.transform.scale),
  });

  return { id: prop.id };
}

export function updateProp(input: SceneScriptProp & { id?: string; name?: string; delete?: boolean }) {
  const target = findObject(input.id ?? input.name, "prop");
  if (!target) throw new Error("Prop not found");

  const store = useDirectorStore.getState();
  if (input.name && input.name !== target.name) store.updateObjectName(target.id, input.name);
  if (input.color) store.updateObjectColor(target.id, input.color);
  store.updateObjectTransform(target.id, getTransformPatch(input, target.transform));

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

export function applySceneScript(script: SceneScript = {}) {
  const scenePlan = script.scenePlan ? validateScenePlan(script.scenePlan).plan : null;
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

  const characterIds = (script.characters ?? []).map((character) => addCharacter(character).id);
  const propIds = (script.props ?? []).map((prop) => addProp(prop).id);
  const requestedCameras = [...(script.camera ? [script.camera] : []), ...(script.cameras ?? [])];
  const cameraIdMap = new Map<string, string>();
  const cameraIds = requestedCameras.map((camera) => {
    const id = addCamera(camera).id;
    if (camera.id) cameraIdMap.set(camera.id, id);
    return id;
  });
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
  if (scenePlan) useDirectorStore.getState().setScenePlan(scenePlan);

  return { characterIds, propIds, cameraIds, scenePlan: scenePlan ? buildScenePlanReview(scenePlan) : null };
}

export function exportSceneScript(): SceneScript {
  const project = useDirectorStore.getState().project;
  const panoramaAsset = project.assets.find((asset) => asset.id === project.panoramaAssetId && asset.kind === "panorama");
  const characters: SceneScriptCharacter[] = project.objects
    .filter((object) => object.kind === "character")
    .map((object) => ({
      id: object.id,
      name: object.name,
      bodyType: object.bodyType,
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
          }
        : undefined,
    }));
  const props: SceneScriptProp[] = project.objects
    .filter((object) => object.kind === "prop" || object.kind === "scene")
    .map((object) => ({
      id: object.id,
      name: object.name,
      geometryType: object.geometryType ?? "box",
      position: object.transform.position,
      rotation: object.transform.rotation,
      scale: object.transform.scale,
      color: object.color,
    }));
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
    props,
    cameras,
    activeCameraId: project.activeCameraId,
    cameraAnimations: project.cameraAnimations,
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
    case "delete_object":
      return deleteObject(args as { id?: string; name?: string });
    case "add_character":
      return addCharacter(args as SceneScriptCharacter);
    case "update_character":
      return updateCharacter(args as SceneScriptCharacter);
    case "add_prop":
      return addProp(args as SceneScriptProp);
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
