import { Euler, Quaternion, Vector3 } from "three";
import type { DirectorMaterialSettings, GeometryPrimitiveType } from "../schema/directorProject";
import type { SceneScript, SceneScriptGroup, SceneScriptProp } from "./directorAgent";

type Vec3 = [number, number, number];

type ObjectSculptMaterial = {
  id?: unknown;
  name?: unknown;
  baseColor?: unknown;
  color?: unknown;
  roughness?: unknown;
  metalness?: unknown;
  opacity?: unknown;
  emissive?: unknown;
  emissiveIntensity?: unknown;
};

type ObjectSculptComponent = {
  id?: unknown;
  name?: unknown;
  primitive?: unknown;
  parent?: unknown;
  material?: unknown;
  dimensions?: unknown;
  transform?: unknown;
  geometryDescriptor?: unknown;
  actionProfile?: unknown;
  attachment?: unknown;
};

export type ObjectSculptSpec = {
  targetName: string;
  componentTree: ObjectSculptComponent[];
  materials: ObjectSculptMaterial[];
  directorPlacement?: {
    position?: number[];
    rotation?: number[];
    scale?: number[];
  };
};

const MAX_COMPONENTS = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toVec3(value: unknown, fallback: Vec3): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) return [...fallback];
  return value.map((item, index) => toFiniteNumber(item, fallback[index])) as Vec3;
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function scalarOrBase(value: unknown, fallback: number) {
  if (typeof value === "number") return value;
  if (isRecord(value) && typeof value.base === "number") return value.base;
  return fallback;
}

function safeId(value: string, fallback: string) {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function getDimensions(component: ObjectSculptComponent): Vec3 {
  if (!isRecord(component.dimensions)) return [1, 1, 1];
  const radius = toFiniteNumber(component.dimensions.radius, 0.5);
  return [
    Math.max(0.001, toFiniteNumber(component.dimensions.width, radius * 2)),
    Math.max(0.001, toFiniteNumber(component.dimensions.height, toFiniteNumber(component.dimensions.length, 1))),
    Math.max(0.001, toFiniteNumber(component.dimensions.depth, radius * 2)),
  ];
}

function getTransform(component: ObjectSculptComponent) {
  const transform = isRecord(component.transform) ? component.transform : {};
  const dimensions = getDimensions(component);
  const authoredScale = toVec3(transform.scale, [1, 1, 1]);
  return {
    position: toVec3(transform.position, [0, 0, 0]),
    rotation: toVec3(transform.rotation, [0, 0, 0]),
    scale: dimensions.map((value, axis) => Math.max(0.001, value * Math.abs(authoredScale[axis]))) as Vec3,
  };
}

function getEndpointTransform(component: ObjectSculptComponent) {
  if (!isRecord(component.attachment)) return null;
  const start = toVec3(component.attachment.localStart, [0, 0, 0]);
  const end = toVec3(component.attachment.localEnd, start);
  const direction = new Vector3(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
  const length = direction.length();
  if (length < 0.0001) return null;
  const baseRadius = Math.max(0.001, toFiniteNumber(component.attachment.baseRadius, 0.08));
  const endRadius = Math.max(0.001, toFiniteNumber(component.attachment.endRadius, baseRadius));
  const midpoint: Vec3 = [
    (start[0] + end[0]) / 2,
    (start[1] + end[1]) / 2,
    (start[2] + end[2]) / 2,
  ];
  const quaternion = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
  const euler = new Euler().setFromQuaternion(quaternion, "XYZ");
  return {
    position: midpoint,
    rotation: [euler.x, euler.y, euler.z] as Vec3,
    scale: [Math.max(baseRadius, endRadius) * 2, length, Math.max(baseRadius, endRadius) * 2] as Vec3,
  };
}

function mapPrimitive(component: ObjectSculptComponent, warnings: string[]): GeometryPrimitiveType {
  const primitive = typeof component.primitive === "string" ? component.primitive : "box";
  if (primitive === "box") {
    const descriptor = isRecord(component.geometryDescriptor) ? component.geometryDescriptor : {};
    const edgeTreatment = isRecord(descriptor.edgeTreatment) ? descriptor.edgeTreatment : {};
    return toFiniteNumber(edgeTreatment.bevelRadius, 0) > 0 ? "rounded-box" : "box";
  }
  const direct: Partial<Record<string, GeometryPrimitiveType>> = {
    sphere: "sphere",
    ellipsoid: "ellipsoid",
    cylinder: "cylinder",
    cone: "cone",
    capsule: "capsule",
    torus: "torus",
    "plane-card": "plane-card",
  };
  if (direct[primitive]) return direct[primitive]!;
  const fallback: Record<string, GeometryPrimitiveType> = {
    tube: "pipe",
    "curve-sweep": "pipe",
    lathe: "cylinder",
    extrude: "rounded-box",
    "instanced-cluster": "sphere",
  };
  if (fallback[primitive]) {
    warnings.push(`部件 ${String(component.name ?? component.id ?? "未命名")} 的 ${primitive} 已使用 ${fallback[primitive]} 安全近似；可在导演台继续细化。`);
    return fallback[primitive];
  }
  warnings.push(`未知基础体 ${primitive} 已替换为 box。`);
  return "box";
}

function normalizeMaterial(material: ObjectSculptMaterial | undefined) {
  const color = typeof material?.baseColor === "string"
    ? material.baseColor
    : typeof material?.color === "string"
      ? material.color
      : "#8a7a5f";
  const settings: DirectorMaterialSettings = {
    roughness: clamp(scalarOrBase(material?.roughness, 0.68)),
    metalness: clamp(scalarOrBase(material?.metalness, 0.02)),
    opacity: clamp(toFiniteNumber(material?.opacity, 1)),
  };
  if (typeof material?.emissive === "string") settings.emissive = material.emissive;
  if (typeof material?.emissiveIntensity === "number") {
    settings.emissiveIntensity = clamp(material.emissiveIntensity, 0, 10);
  }
  return { color, settings };
}

function getPivot(component: ObjectSculptComponent): Vec3 {
  if (!isRecord(component.actionProfile) || !isRecord(component.actionProfile.pivot)) return [0, 0, 0];
  return toVec3(component.actionProfile.pivot.localPosition, [0, 0, 0]);
}

export function isObjectSculptSpec(value: unknown): value is ObjectSculptSpec {
  if (!isRecord(value)) return false;
  return typeof value.targetName === "string" && Array.isArray(value.componentTree) && Array.isArray(value.materials);
}

export function convertObjectSculptSpecToSceneScript(spec: ObjectSculptSpec): {
  script: SceneScript;
  warnings: string[];
} {
  if (!spec.targetName.trim()) throw new Error("ObjectSculptSpec.targetName 不能为空");
  if (!spec.componentTree.length) throw new Error("ObjectSculptSpec.componentTree 至少需要一个部件");
  if (spec.componentTree.length > MAX_COMPONENTS) throw new Error(`程序化道具最多支持 ${MAX_COMPONENTS} 个部件`);

  const warnings: string[] = [];
  const idMap = new Map<string, string>();
  const components = spec.componentTree.map((component, index) => {
    if (!isRecord(component)) throw new Error(`componentTree[${index}] 必须是对象`);
    const rawId = typeof component.id === "string" ? component.id : `component_${index + 1}`;
    const id = safeId(rawId, `component_${index + 1}`);
    idMap.set(rawId, id);
    return { ...component, id } as ObjectSculptComponent & { id: string };
  });
  const ids = new Set<string>();
  components.forEach((component) => {
    if (ids.has(component.id)) throw new Error(`ObjectSculptSpec 存在重复部件 ID：${component.id}`);
    ids.add(component.id);
  });

  const materialMap = new Map<string, ObjectSculptMaterial>();
  spec.materials.forEach((material, index) => {
    if (!isRecord(material)) return;
    const id = typeof material.id === "string" ? material.id : `material_${index + 1}`;
    materialMap.set(id, material);
  });

  const childrenByParent = new Map<string | null, Array<ObjectSculptComponent & { id: string }>>();
  components.forEach((component) => {
    const parent = typeof component.parent === "string" && component.parent.trim()
      ? idMap.get(component.parent) ?? component.parent
      : null;
    if (parent && !ids.has(parent)) throw new Error(`部件 ${component.id} 引用了不存在的父级 ${parent}`);
    const siblings = childrenByParent.get(parent) ?? [];
    siblings.push(component);
    childrenByParent.set(parent, siblings);
  });

  const componentById = new Map(components.map((component) => [component.id, component]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const validateAncestors = (componentId: string) => {
    if (visited.has(componentId)) return;
    if (visiting.has(componentId)) throw new Error(`ObjectSculptSpec 层级存在循环：${componentId}`);
    visiting.add(componentId);
    const component = componentById.get(componentId)!;
    const parent = typeof component.parent === "string" && component.parent.trim()
      ? idMap.get(component.parent) ?? component.parent
      : null;
    if (parent) validateAncestors(parent);
    visiting.delete(componentId);
    visited.add(componentId);
  };
  components.forEach((component) => validateAncestors(component.id));

  const buildPart = (component: ObjectSculptComponent & { id: string }, ancestry: Set<string>): SceneScriptProp => {
    if (ancestry.has(component.id)) throw new Error(`ObjectSculptSpec 层级存在循环：${component.id}`);
    const nextAncestry = new Set(ancestry).add(component.id);
    const materialId = typeof component.material === "string" ? component.material : "";
    const material = normalizeMaterial(materialMap.get(materialId));
    const endpointTransform = getEndpointTransform(component);
    const transform = endpointTransform ?? getTransform(component);
    return {
      id: component.id,
      name: typeof component.name === "string" && component.name.trim() ? component.name : component.id,
      geometryType: mapPrimitive(component, warnings),
      geometryAnchor: "center",
      color: material.color,
      material: material.settings,
      position: transform.position,
      rotation: transform.rotation,
      scale: transform.scale,
      pivot: getPivot(component),
      children: (childrenByParent.get(component.id) ?? []).map((child) => buildPart(child, nextAncestry)),
    };
  };

  const placement = isRecord(spec.directorPlacement) ? spec.directorPlacement : {};
  const root: SceneScriptGroup = {
    kind: "group",
    id: `sculpt_${safeId(spec.targetName, "object")}`,
    name: spec.targetName,
    position: toVec3(placement.position, [0, 0, 0]),
    rotation: toVec3(placement.rotation, [0, 0, 0]),
    scale: toVec3(placement.scale, [1, 1, 1]),
    children: (childrenByParent.get(null) ?? []).map((component) => buildPart(component, new Set())),
  };
  if (!root.children?.length) throw new Error("ObjectSculptSpec 没有可作为根节点的部件，请检查 parent 层级");

  return {
    script: {
      groups: [root],
    },
    warnings: [...new Set(warnings)],
  };
}
