import { Html, Line, RoundedBox, TransformControls, type TransformControlsProps } from "@react-three/drei";
import { useFrame, useLoader, useThree, type ThreeEvent } from "@react-three/fiber";
import { Component, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { AnimationMixer, Box3, DoubleSide, ExtrudeGeometry, Matrix4, Plane, Quaternion, Shape, Vector2, Vector3, type Group, type Mesh, type Object3D } from "three";
import type { TransformControls as TransformControlsImpl } from "three-stdlib";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type {
  DirectorAssetRef,
  DirectorCameraShot,
  DirectorObject,
  GeometryPrimitiveType,
} from "../schema/directorProject";
import {
  VIEWPORT_CAMERA_ASPECT,
  VIEWPORT_CAMERA_FRUSTUM_DEPTH,
  VIEWPORT_CAMERA_FRUSTUM_FRAME_WIDTH,
  VIEWPORT_CAMERA_VISUAL_SCALE,
} from "../schema/cameraGeometry";
import { VIEWPORT_OBJECT_LABEL_VERTICAL_GAP } from "../schema/viewportLabels";
import type { TransformMode } from "../store/directorStore";
import { useDirectorStore } from "../store/directorStore";
import { CharacterModel } from "../runtime/CharacterModel";
import { getActionTrackDuration, useAnimatedCharacterRigState } from "../animation/characterAnimation";
import { getGroundedLabelY } from "../runtime/mannequin/bodyTypes";
import { getUE4GroundedLabelY } from "../runtime/ue4Mannequin/ue4MannequinRig";
import { getEffectiveGroundOpacity } from "./panoramaMath";
import { getCrowdAnchorTransform } from "../store/directorStore";
import { getObjectAnimationElapsed, sampleObjectAnimation } from "../animation/objectAnimation";

export { getEffectiveGroundOpacity, getPanoramaRotationRadians } from "./panoramaMath";

const VIEWPORT_CAMERA_LINE = "#A9D8FF";
const VIEWPORT_CAMERA_LINE_OPACITY = 0.92;
const VIEWPORT_CAMERA_HIT_PADDING = 0.06;
const VIEWPORT_CAMERA_FORWARD = new Vector3(0, 0, 1);
const VIEWPORT_CAMERA_WORLD_UP = new Vector3(0, 1, 0);
const HIDE_FROM_VIEWPORT_CAPTURE_KEY = "hideFromViewportCapture";
const VIEWPORT_CAMERA_BODY_CENTER: CameraWirePoint = [0, 0, -0.52 * VIEWPORT_CAMERA_VISUAL_SCALE];
const VIEWPORT_CAMERA_BODY_SIZE: CameraWirePoint = [
  0.4 * VIEWPORT_CAMERA_VISUAL_SCALE,
  0.4 * VIEWPORT_CAMERA_VISUAL_SCALE,
  1 * VIEWPORT_CAMERA_VISUAL_SCALE,
];
const VIEWPORT_CAMERA_BODY_FRONT_Z = VIEWPORT_CAMERA_BODY_CENTER[2] + VIEWPORT_CAMERA_BODY_SIZE[2] / 2;
const VIEWPORT_CAMERA_LENS_TIP: CameraWirePoint = [0, 0, 0.2 * VIEWPORT_CAMERA_VISUAL_SCALE];
const ROLE_LABEL_DISTANCE_FACTOR = 3;
const IMPORTED_MODEL_TARGET_MAX_SIZE = 2;
type CameraWirePoint = [number, number, number];
type CameraWirePointLine = CameraWirePoint[];
type CameraWirePart = "body" | "lens" | "reel";
type CameraWireLine = {
  part: CameraWirePart;
  points: CameraWirePointLine;
};
type CameraHitArea = {
  args: CameraWirePoint;
  position: CameraWirePoint;
};

function ViewportObjectLabel({
  children,
  position,
}: {
  children: ReactNode;
  position: [number, number, number];
}) {
  return (
    <Html
      center
      distanceFactor={ROLE_LABEL_DISTANCE_FACTOR}
      pointerEvents="none"
      position={position}
      sprite
      transform
      zIndexRange={[0, 1]}
    >
      <div className="role-label">{children}</div>
    </Html>
  );
}

function ViewportTransformControls({
  mode,
  object,
  onObjectChange,
  translationSnap,
}: {
  mode: TransformMode;
  object: TransformControlsProps["object"];
  onObjectChange: TransformControlsProps["onObjectChange"];
  translationSnap?: number | null;
}) {
  const controlsRef = useRef<TransformControlsImpl | null>(null);
  const setControlsRef = useCallback((controls: TransformControlsImpl | null) => {
    controlsRef.current = controls;
    if (controls) {
      controls.userData[HIDE_FROM_VIEWPORT_CAPTURE_KEY] = true;
    }
  }, []);
  const beginUndoBatch = useDirectorStore((state) => state.beginUndoBatch);
  const endUndoBatch = useDirectorStore((state) => state.endUndoBatch);

  return (
    <TransformControls
      ref={setControlsRef}
      mode={mode}
      object={object}
      onMouseDown={beginUndoBatch}
      onMouseUp={endUndoBatch}
      onObjectChange={onObjectChange}
      translationSnap={translationSnap ?? undefined}
      userData={{ [HIDE_FROM_VIEWPORT_CAPTURE_KEY]: true }}
    />
  );
}

export function getViewportCameraQuaternion(
  position: [number, number, number],
  target: [number, number, number]
) {
  const origin = new Vector3(...position);
  const direction = new Vector3(...target).sub(origin);
  if (direction.lengthSq() === 0) return new Quaternion();

  const forward = direction.normalize();
  const up =
    Math.abs(forward.dot(VIEWPORT_CAMERA_WORLD_UP)) > 0.999
      ? new Vector3(0, 0, 1)
      : VIEWPORT_CAMERA_WORLD_UP;
  const matrix = new Matrix4().lookAt(origin, origin.clone().sub(forward), up);

  return new Quaternion().setFromRotationMatrix(matrix);
}

export function getViewportCameraOpaqueDepthRange() {
  const zValues = getViewportCameraBodyWireframeLines()
    .filter((line) => line.part !== "lens")
    .flatMap((line) => line.points)
    .map((point) => point[2]);

  return {
    minZ: Math.min(...zValues),
    maxZ: Math.max(...zValues),
  };
}

export function getViewportCameraLabelY() {
  const points = getViewportCameraBodyWireframeLines().flatMap((line) => line.points);
  const modelTopY = Math.max(...points.map((point) => point[1]));

  return modelTopY + VIEWPORT_OBJECT_LABEL_VERTICAL_GAP;
}

export function getImportedModelNormalization(bounds: Box3, targetMaxSize = IMPORTED_MODEL_TARGET_MAX_SIZE) {
  if (bounds.isEmpty()) {
    return {
      position: [0, 0, 0] as [number, number, number],
      scale: 1,
    };
  }

  const size = new Vector3();
  const center = new Vector3();
  bounds.getSize(size);
  bounds.getCenter(center);

  const maxSize = Math.max(size.x, size.y, size.z);
  const scale = Number.isFinite(maxSize) && maxSize > 0 ? targetMaxSize / maxSize : 1;

  return {
    position: [-center.x * scale, -bounds.min.y * scale, -center.z * scale] as [number, number, number],
    scale,
  };
}

function createBoxWireframeLines({
  center,
  size,
}: {
  center: CameraWirePoint;
  size: CameraWirePoint;
}): CameraWirePointLine[] {
  const [cx, cy, cz] = center;
  const [width, height, depth] = size;
  const x0 = cx - width / 2;
  const x1 = cx + width / 2;
  const y0 = cy - height / 2;
  const y1 = cy + height / 2;
  const z0 = cz - depth / 2;
  const z1 = cz + depth / 2;
  const corners: Record<string, CameraWirePoint> = {
    bbl: [x0, y0, z0],
    bbr: [x1, y0, z0],
    btl: [x0, y1, z0],
    btr: [x1, y1, z0],
    fbl: [x0, y0, z1],
    fbr: [x1, y0, z1],
    ftl: [x0, y1, z1],
    ftr: [x1, y1, z1],
  };

  return [
    [corners.bbl, corners.bbr],
    [corners.bbr, corners.btr],
    [corners.btr, corners.btl],
    [corners.btl, corners.bbl],
    [corners.fbl, corners.fbr],
    [corners.fbr, corners.ftr],
    [corners.ftr, corners.ftl],
    [corners.ftl, corners.fbl],
    [corners.bbl, corners.fbl],
    [corners.bbr, corners.fbr],
    [corners.btr, corners.ftr],
    [corners.btl, corners.ftl],
  ];
}

function createCircleWireframeLine({
  center,
  radius,
  segments = 32,
  plane = "xy",
}: {
  center: CameraWirePoint;
  radius: number;
  segments?: number;
  plane?: "xy" | "xz" | "yz";
}): CameraWirePointLine {
  const [cx, cy, cz] = center;
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / segments;
    const a = Math.cos(angle) * radius;
    const b = Math.sin(angle) * radius;

    if (plane === "xz") return [cx + a, cy, cz + b];
    if (plane === "yz") return [cx, cy + a, cz + b];

    return [cx + a, cy + b, cz];
  });
}

function createInvertedTetrahedronLensWireframeLines(): CameraWirePointLine[] {
  const backTopLeft: CameraWirePoint = [
    -0.10 * VIEWPORT_CAMERA_VISUAL_SCALE,
    0.10 * VIEWPORT_CAMERA_VISUAL_SCALE,
    VIEWPORT_CAMERA_BODY_FRONT_Z,
  ];
  const backTopRight: CameraWirePoint = [
    0.10 * VIEWPORT_CAMERA_VISUAL_SCALE,
    0.10 * VIEWPORT_CAMERA_VISUAL_SCALE,
    VIEWPORT_CAMERA_BODY_FRONT_Z,
  ];
  const backBottomRight: CameraWirePoint = [
    0.10 * VIEWPORT_CAMERA_VISUAL_SCALE,
    -0.10 * VIEWPORT_CAMERA_VISUAL_SCALE,
    VIEWPORT_CAMERA_BODY_FRONT_Z,
  ];
  const backBottomLeft: CameraWirePoint = [
    -0.10 * VIEWPORT_CAMERA_VISUAL_SCALE,
    -0.10 * VIEWPORT_CAMERA_VISUAL_SCALE,
    VIEWPORT_CAMERA_BODY_FRONT_Z,
  ];

  const frontTopLeft: CameraWirePoint = [
    -0.25 * VIEWPORT_CAMERA_VISUAL_SCALE,
    0.2 * VIEWPORT_CAMERA_VISUAL_SCALE,
    VIEWPORT_CAMERA_LENS_TIP[2],
  ];
  const frontTopRight: CameraWirePoint = [
    0.25 * VIEWPORT_CAMERA_VISUAL_SCALE,
    0.2 * VIEWPORT_CAMERA_VISUAL_SCALE,
    VIEWPORT_CAMERA_LENS_TIP[2],
  ];
  const frontBottomRight: CameraWirePoint = [
    0.25 * VIEWPORT_CAMERA_VISUAL_SCALE,
    -0.2 * VIEWPORT_CAMERA_VISUAL_SCALE,
    VIEWPORT_CAMERA_LENS_TIP[2],
  ];
  const frontBottomLeft: CameraWirePoint = [
    -0.25 * VIEWPORT_CAMERA_VISUAL_SCALE,
    -0.2 * VIEWPORT_CAMERA_VISUAL_SCALE,
    VIEWPORT_CAMERA_LENS_TIP[2],
  ];

  return [
    [backTopLeft, backTopRight, backBottomRight, backBottomLeft, backTopLeft],
    [frontTopLeft, frontTopRight, frontBottomRight, frontBottomLeft, frontTopLeft],

    [backTopLeft, frontTopLeft],
    [backTopRight, frontTopRight],
    [backBottomRight, frontBottomRight],
    [backBottomLeft, frontBottomLeft],

  ];
}
function withCameraPart(part: CameraWirePart, lines: CameraWirePointLine[]): CameraWireLine[] {
  return lines.map((points) => ({ part, points }));
}

export function getViewportCameraBodyWireframeLines(): CameraWireLine[] {
  return [
    ...withCameraPart("body", [
      ...createBoxWireframeLines({ center: VIEWPORT_CAMERA_BODY_CENTER, size: VIEWPORT_CAMERA_BODY_SIZE }),
    ]),
    ...withCameraPart("lens", createInvertedTetrahedronLensWireframeLines()),
    ...withCameraPart("reel", [
      createCircleWireframeLine({
        center: [0, 0.44 * VIEWPORT_CAMERA_VISUAL_SCALE, -0.78 * VIEWPORT_CAMERA_VISUAL_SCALE],
        radius: 0.21 * VIEWPORT_CAMERA_VISUAL_SCALE,
        plane: "yz",
      }),
      createCircleWireframeLine({
        center: [0, 0.44 * VIEWPORT_CAMERA_VISUAL_SCALE, -0.34 * VIEWPORT_CAMERA_VISUAL_SCALE],
        radius: 0.21 * VIEWPORT_CAMERA_VISUAL_SCALE,
        plane: "yz",
      }),
    ]),
  ];
}

export function getViewportCameraHitArea(): CameraHitArea {
  const points = getViewportCameraBodyWireframeLines().flatMap((line) => line.points);
  const minX = Math.min(...points.map((point) => point[0]));
  const maxX = Math.max(...points.map((point) => point[0]));
  const minY = Math.min(...points.map((point) => point[1]));
  const maxY = Math.max(...points.map((point) => point[1]));
  const minZ = Math.min(...points.map((point) => point[2]));
  const maxZ = Math.max(...points.map((point) => point[2]));

  return {
    args: [
      maxX - minX + VIEWPORT_CAMERA_HIT_PADDING * 2,
      maxY - minY + VIEWPORT_CAMERA_HIT_PADDING * 2,
      maxZ - minZ + VIEWPORT_CAMERA_HIT_PADDING * 2,
    ],
    position: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
  };
}

function tintImportedObject(object: Object3D, color?: string) {
  if (!color) return;

  object.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    const originalMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const tintedMaterials = originalMaterials.map((material) => {
      const copy = material.clone() as typeof material & { color?: { set: (value: string) => unknown } };
      copy.color?.set(color);
      return copy;
    });
    mesh.material = Array.isArray(mesh.material) ? tintedMaterials : tintedMaterials[0];
  });
}

function NormalizedImportedObject({ color, object }: { color?: string; object: Object3D }) {
  const { clone, normalization } = useMemo(() => {
    const clonedObject = object.clone(true);
    tintImportedObject(clonedObject, color);
    clonedObject.updateMatrixWorld(true);

    return {
      clone: clonedObject,
      normalization: getImportedModelNormalization(new Box3().setFromObject(clonedObject)),
    };
  }, [color, object]);

  return (
    <group
      position={normalization.position}
      scale={[normalization.scale, normalization.scale, normalization.scale]}
    >
      <primitive object={clone} />
    </group>
  );
}

function FbxModel({
  animated = false,
  animationDuration,
  animationElapsed,
  color,
  url,
}: {
  animated?: boolean;
  animationDuration?: number;
  animationElapsed?: number;
  color?: string;
  url: string;
}) {
  const object = useLoader(FBXLoader, url);

  const { actions, clone, mixer, normalization } = useMemo(() => {
    const clonedObject = object.clone(true);
    tintImportedObject(clonedObject, color);
    clonedObject.updateMatrixWorld(true);
    const nextMixer = animated ? new AnimationMixer(clonedObject) : null;
    const clips = (object as Object3D & { animations?: Parameters<AnimationMixer["clipAction"]>[0][] }).animations ?? [];
    const nextActions = nextMixer ? clips.map((clip) => nextMixer.clipAction(clip).reset().play()) : [];
    return {
      actions: nextActions,
      clone: clonedObject,
      mixer: nextMixer,
      normalization: getImportedModelNormalization(new Box3().setFromObject(clonedObject)),
    };
  }, [animated, color, object]);

  useEffect(
    () => () => {
      mixer?.stopAllAction();
    },
    [mixer]
  );
  useFrame((_, delta) => {
    if (!mixer) return;
    if (typeof animationElapsed !== "number") {
      actions.forEach((action) => {
        action.paused = false;
      });
      mixer.update(delta);
      return;
    }
    const duration = Math.max(animationDuration ?? 5, 5);
    actions.forEach((action) => {
      action.paused = true;
      action.time = ((animationElapsed % duration) / duration) * action.getClip().duration;
    });
    mixer.update(0);
  });

  return (
    <group position={normalization.position} scale={[normalization.scale, normalization.scale, normalization.scale]}>
      <primitive object={clone} />
    </group>
  );
}

function ObjModel({ color, url }: { color?: string; url: string }) {
  const object = useLoader(OBJLoader, url);

  return <NormalizedImportedObject color={color} object={object} />;
}

function GltfModel({
  animated = false,
  animationDuration,
  animationElapsed,
  color,
  url,
}: {
  animated?: boolean;
  animationDuration?: number;
  animationElapsed?: number;
  color?: string;
  url: string;
}) {
  const gltf = useLoader(GLTFLoader, url, (loader) => loader.setMeshoptDecoder(MeshoptDecoder));
  const { actions, clone, mixer, normalization } = useMemo(() => {
    const clonedObject = cloneSkeleton(gltf.scene) as Group;
    tintImportedObject(clonedObject, color);
    clonedObject.updateMatrixWorld(true);
    const nextMixer = animated ? new AnimationMixer(clonedObject) : null;
    const nextActions = nextMixer ? gltf.animations.map((clip) => nextMixer.clipAction(clip).reset().play()) : [];
    return {
      actions: nextActions,
      clone: clonedObject,
      mixer: nextMixer,
      normalization: getImportedModelNormalization(new Box3().setFromObject(clonedObject)),
    };
  }, [animated, color, gltf.animations, gltf.scene]);

  useEffect(
    () => () => {
      mixer?.stopAllAction();
    },
    [mixer]
  );
  useFrame((_, delta) => {
    if (!mixer) return;
    if (typeof animationElapsed !== "number") {
      actions.forEach((action) => {
        action.paused = false;
      });
      mixer.update(delta);
      return;
    }
    const duration = Math.max(animationDuration ?? 5, 5);
    actions.forEach((action) => {
      action.paused = true;
      action.time = ((animationElapsed % duration) / duration) * action.getClip().duration;
    });
    mixer.update(0);
  });

  return (
    <group position={normalization.position} scale={[normalization.scale, normalization.scale, normalization.scale]}>
      <primitive object={clone} />
    </group>
  );
}

function ImportedModel({
  animated,
  animationDuration,
  animationElapsed,
  color,
  fileName,
  url,
}: {
  animated?: boolean;
  animationDuration?: number;
  animationElapsed?: number;
  color?: string;
  fileName: string;
  url: string;
}) {
  if (/\.fbx$/i.test(fileName)) {
    return <FbxModel animated={animated} animationDuration={animationDuration} animationElapsed={animationElapsed} color={color} url={url} />;
  }
  if (/\.glb$|\.gltf$/i.test(fileName)) {
    return <GltfModel animated={animated} animationDuration={animationDuration} animationElapsed={animationElapsed} color={color} url={url} />;
  }
  if (/\.obj$/i.test(fileName)) return <ObjModel color={color} url={url} />;
  return null;
}

class ImportedModelBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function ImportedModelFallback({ color = "#ff9f43" }: { color?: string }) {
  return (
    <mesh name="missing-imported-model" position={[0, 0.9, 0]}>
      <boxGeometry args={[0.9, 1.8, 0.6]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.15} wireframe />
    </mesh>
  );
}

function GeometryPrimitiveModel({
  color = "#d7e7ff",
  geometryType,
}: {
  color?: string;
  geometryType: GeometryPrimitiveType;
}) {
  const material = <meshStandardMaterial color={color} metalness={0.02} roughness={0.68} />;

  if (geometryType === "rounded-box") {
    return (
      <RoundedBox args={[1, 1, 1]} position={[0, 0.5, 0]} radius={0.12} smoothness={4} name="geometry-rounded-box">
        {material}
      </RoundedBox>
    );
  }

  if (geometryType === "sphere") {
    return (
      <mesh name="geometry-sphere" position={[0, 0.55, 0]}>
        <sphereGeometry args={[0.55, 32, 16]} />
        {material}
      </mesh>
    );
  }

  if (geometryType === "hemisphere") {
    return (
      <mesh name="geometry-hemisphere" position={[0, 0, 0]}>
        <sphereGeometry args={[0.55, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        {material}
      </mesh>
    );
  }

  if (geometryType === "capsule") {
    return (
      <mesh name="geometry-capsule" position={[0, 0.8, 0]}>
        <capsuleGeometry args={[0.35, 0.9, 8, 24]} />
        {material}
      </mesh>
    );
  }

  if (geometryType === "cylinder") {
    return (
      <mesh name="geometry-cylinder" position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.45, 0.45, 1.2, 32]} />
        {material}
      </mesh>
    );
  }

  if (geometryType === "pipe") {
    return (
      <mesh name="geometry-pipe" position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.5, 0.5, 1.2, 32, 1, true]} />
        <meshStandardMaterial color={color} metalness={0.08} roughness={0.58} side={DoubleSide} />
      </mesh>
    );
  }

  if (geometryType === "disc") {
    return (
      <mesh name="geometry-disc" position={[0, 0.04, 0]}>
        <cylinderGeometry args={[0.55, 0.55, 0.08, 32]} />
        {material}
      </mesh>
    );
  }

  if (geometryType === "plane") {
    return (
      <mesh name="geometry-plane" position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1, 1]} />
        <meshStandardMaterial color={color} metalness={0.02} roughness={0.68} side={DoubleSide} />
      </mesh>
    );
  }

  if (geometryType === "wedge") {
    return <WedgeModel color={color} />;
  }

  if (geometryType === "torus") {
    return (
      <mesh name="geometry-torus" position={[0, 0.14, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.45, 0.14, 16, 48]} />
        {material}
      </mesh>
    );
  }

  if (geometryType === "cone") {
    return (
      <mesh name="geometry-cone" position={[0, 0.55, 0]}>
        <coneGeometry args={[0.5, 1.1, 32]} />
        {material}
      </mesh>
    );
  }

  if (geometryType === "pyramid") {
    return (
      <mesh name="geometry-pyramid" position={[0, 0.55, 0]}>
        <coneGeometry args={[0.55, 1.1, 4]} />
        {material}
      </mesh>
    );
  }

  return (
    <mesh name="geometry-box" position={[0, 0.5, 0]}>
      <boxGeometry args={[1, 1, 1]} />
      {material}
    </mesh>
  );
}

function WedgeModel({ color }: { color: string }) {
  const geometry = useMemo(() => {
    const shape = new Shape();
    shape.moveTo(-0.5, 0);
    shape.lineTo(0.5, 0);
    shape.lineTo(-0.5, 1);
    shape.closePath();
    const result = new ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
    result.translate(0, 0, -0.5);
    return result;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh name="geometry-wedge" geometry={geometry}>
      <meshStandardMaterial color={color} metalness={0.02} roughness={0.68} />
    </mesh>
  );
}

type PoseJointName =
  | "body"
  | "torso"
  | "head"
  | "leftShoulder"
  | "rightShoulder"
  | "leftElbow"
  | "rightElbow"
  | "leftHand"
  | "rightHand"
  | "leftHip"
  | "rightHip"
  | "leftKnee"
  | "rightKnee"
  | "leftFoot"
  | "rightFoot";

type PoseJointPositions = Partial<Record<PoseJointName, [number, number, number]>>;

const TERMINAL_JOINTS = new Set<PoseJointName>(["head", "leftHand", "rightHand", "leftFoot", "rightFoot"]);

function clampPose(value: number, min = -90, max = 90) {
  return Math.min(Math.max(value, min), max);
}

function getSegmentControls(
  root: [number, number, number],
  target: [number, number, number],
  side: "left" | "right",
  prefix: "Shoulder" | "Hip"
) {
  const vector = new Vector3(...target).sub(new Vector3(...root));
  const sideSign = side === "left" ? -1 : 1;
  const degrees = (radians: number) => (radians * 180) / Math.PI;
  return {
    [`${side}${prefix}.pitch`]: clampPose(degrees(Math.atan2(-vector.z, Math.max(-vector.y, 0.001))), -150, 150),
    [`${side}${prefix}.spread`]: clampPose(sideSign * degrees(Math.atan2(vector.x, Math.max(-vector.y, 0.001))), -150, 150),
  };
}

function getJointBend(root: [number, number, number], joint: [number, number, number], end: [number, number, number]) {
  const first = new Vector3(...root).sub(new Vector3(...joint));
  const second = new Vector3(...end).sub(new Vector3(...joint));
  const denominator = Math.max(first.length() * second.length(), 0.0001);
  const angle = Math.acos(Math.min(Math.max(first.dot(second) / denominator, -1), 1));
  return clampPose(180 - (angle * 180) / Math.PI, 0, 155);
}

function getLimbIkControls(
  root: [number, number, number],
  middle: [number, number, number],
  end: [number, number, number],
  target: [number, number, number],
  side: "left" | "right",
  prefix: "Shoulder" | "Hip",
  bendKey: string
) {
  const rootPoint = new Vector3(...root);
  const middlePoint = new Vector3(...middle);
  const targetPoint = new Vector3(...target);
  const upperLength = rootPoint.distanceTo(middlePoint);
  const lowerLength = middlePoint.distanceTo(new Vector3(...end));
  const vector = targetPoint.sub(rootPoint);
  const distance = Math.min(Math.max(vector.length(), 0.001), Math.max(upperLength + lowerLength - 0.001, 0.001));
  const sideSign = side === "left" ? -1 : 1;
  const degrees = (radians: number) => (radians * 180) / Math.PI;
  const jointAngle = Math.acos(
    clampPose((upperLength * upperLength + lowerLength * lowerLength - distance * distance) / Math.max(2 * upperLength * lowerLength, 0.001), -1, 1)
  );

  return {
    [`${side}${prefix}.pitch`]: clampPose(degrees(Math.atan2(-vector.z, Math.max(-vector.y, 0.001))), -150, 150),
    [`${side}${prefix}.spread`]: clampPose(sideSign * degrees(Math.atan2(vector.x, Math.max(-vector.y, 0.001))), -150, 150),
    [bendKey]: clampPose(180 - degrees(jointAngle), 0, 140),
  };
}

function PoseEditHandles({
  interactionMode,
  item,
  positions,
  parentRef,
  rootOffset,
  onPoseControlChange,
}: {
  interactionMode: "persistent" | "hold";
  item: DirectorObject;
  positions: PoseJointPositions;
  parentRef: MutableRefObject<Group | null>;
  rootOffset: [number, number, number];
  onPoseControlChange?: (characterId: string, controls: Record<string, number>) => void;
}) {
  const [selectedJoint, setSelectedJoint] = useState<PoseJointName | null>(null);
  const draggingJointRef = useRef<PoseJointName | null>(null);
  const dragPlaneRef = useRef(new Plane());
  const dragPointRef = useRef(new Vector3());
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragOriginRef = useRef<[number, number, number] | null>(null);
  const dragPointerOriginRef = useRef<[number, number, number] | null>(null);
  const dragDirectionRef = useRef(1);
  const dragControlsRef = useRef<Record<string, number>>({});
  const updateDragHandlerRef = useRef<(clientX: number, clientY: number, ray: { intersectPlane: (plane: Plane, target: Vector3) => Vector3 | null }) => void>(() => {});
  const cancelDragHandlerRef = useRef<() => void>(() => {});
  const pendingDragRef = useRef<{ joint: PoseJointName; target: [number, number, number] } | null>(null);
  const dragFrameRef = useRef(0);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const raycaster = useThree((state) => state.raycaster);
  const updatePoseControls = useDirectorStore((state) => state.updatePoseControls);
  const beginUndoBatch = useDirectorStore((state) => state.beginUndoBatch);
  const endUndoBatch = useDirectorStore((state) => state.endUndoBatch);
  const currentControls = item.characterRig?.controls ?? {};
  const toHandlePosition = (position: [number, number, number]) =>
    [position[0] + rootOffset[0], position[1] + rootOffset[1], position[2] + rootOffset[2]] as [number, number, number];
  const toBonePosition = (position: [number, number, number]) =>
    [position[0] - rootOffset[0], position[1] - rootOffset[1], position[2] - rootOffset[2]] as [number, number, number];

  function applyControls(nextControls: Record<string, number>) {
    const normalizedControls = Object.fromEntries(
      Object.entries(nextControls).map(([key, value]) => [key, Number(value.toFixed(3))])
    );
    updatePoseControls(item.id, normalizedControls);
    onPoseControlChange?.(item.id, normalizedControls);
  }

  function applyJointTarget(joint: PoseJointName, target: [number, number, number]) {
    if (joint === "leftHand" && positions.leftShoulder && positions.leftElbow) {
      applyControls(getLimbIkControls(positions.leftShoulder, positions.leftElbow, positions.leftHand ?? target, target, "left", "Shoulder", "leftElbow.bend"));
      return;
    }
    if (joint === "rightHand" && positions.rightShoulder && positions.rightElbow) {
      applyControls(getLimbIkControls(positions.rightShoulder, positions.rightElbow, positions.rightHand ?? target, target, "right", "Shoulder", "rightElbow.bend"));
      return;
    }
    if (joint === "leftFoot" && positions.leftHip && positions.leftKnee) {
      applyControls(getLimbIkControls(positions.leftHip, positions.leftKnee, positions.leftFoot ?? target, target, "left", "Hip", "leftKnee.bend"));
      return;
    }
    if (joint === "rightFoot" && positions.rightHip && positions.rightKnee) {
      applyControls(getLimbIkControls(positions.rightHip, positions.rightKnee, positions.rightFoot ?? target, target, "right", "Hip", "rightKnee.bend"));
      return;
    }
    if (joint === "head" && positions.head) {
      return;
    }
    if (joint === "leftElbow" && positions.leftShoulder && positions.leftHand) {
      applyControls({
        ...getSegmentControls(positions.leftShoulder, target, "left", "Shoulder"),
        "leftElbow.bend": getJointBend(positions.leftShoulder, target, positions.leftHand),
      });
      return;
    }
    if (joint === "rightElbow" && positions.rightShoulder && positions.rightHand) {
      applyControls({
        ...getSegmentControls(positions.rightShoulder, target, "right", "Shoulder"),
        "rightElbow.bend": getJointBend(positions.rightShoulder, target, positions.rightHand),
      });
      return;
    }
    if (joint === "leftKnee" && positions.leftHip && positions.leftFoot) {
      applyControls({
        ...getSegmentControls(positions.leftHip, target, "left", "Hip"),
        "leftKnee.bend": getJointBend(positions.leftHip, target, positions.leftFoot),
      });
      return;
    }
    if (joint === "rightKnee" && positions.rightHip && positions.rightFoot) {
      applyControls({
        ...getSegmentControls(positions.rightHip, target, "right", "Hip"),
        "rightKnee.bend": getJointBend(positions.rightHip, target, positions.rightFoot),
      });
      return;
    }

    const original = positions[joint];
    if (!original) return;
    const delta = new Vector3(...target).sub(new Vector3(...original));
    if (joint === "leftShoulder" || joint === "rightShoulder" || joint === "leftHip" || joint === "rightHip") {
      const isShoulder = joint.endsWith("Shoulder");
      const side = joint.startsWith("left") ? "left" : "right";
      const prefix = isShoulder ? "Shoulder" : "Hip";
      const controlPrefix = `${side}${prefix}`;
      applyControls({
        [`${controlPrefix}.pitch`]: clampPose((currentControls[`${controlPrefix}.pitch`] ?? 0) - delta.z * 100, -150, 150),
        [`${controlPrefix}.spread`]: clampPose((currentControls[`${controlPrefix}.spread`] ?? 0) + (side === "left" ? -1 : 1) * delta.x * 120, -150, 150),
        [`${controlPrefix}.twist`]: clampPose((currentControls[`${controlPrefix}.twist`] ?? 0) + delta.y * 80, -150, 150),
      });
      return;
    }
    if (joint === "body" || joint === "torso") {
      applyControls({
        [`${joint}.pitch`]: clampPose((currentControls[`${joint}.pitch`] ?? 0) - delta.z * 100, -110, 110),
        [`${joint}.yaw`]: clampPose((currentControls[`${joint}.yaw`] ?? 0) + delta.x * 100, -110, 110),
        [`${joint}.roll`]: clampPose((currentControls[`${joint}.roll`] ?? 0) + delta.x * 80, -110, 110),
      });
    }
  }

  function updateDirectDragFromPoint(
    clientX: number,
    clientY: number,
    ray: { intersectPlane: (plane: Plane, target: Vector3) => Vector3 | null }
  ) {
    const joint = draggingJointRef.current;
    const dragStart = dragStartRef.current;
    if (!joint || !dragStart) return;
    if (joint === "head") {
      const dx = clientX - dragStart.x;
      const dy = clientY - dragStart.y;
      applyControls({
        "head.yaw": clampPose((dragControlsRef.current["head.yaw"] ?? 0) + dx * 0.28, -65, 65),
        "head.pitch": clampPose((dragControlsRef.current["head.pitch"] ?? 0) - dy * 0.24, -45, 45),
        "head.roll": clampPose(dragControlsRef.current["head.roll"] ?? 0, -25, 25),
      });
      return;
    }
    if (!ray.intersectPlane(dragPlaneRef.current, dragPointRef.current)) return;
    const localPoint = dragPointRef.current.clone();
    parentRef.current?.worldToLocal(localPoint);
    const pointerTarget = toBonePosition([localPoint.x, localPoint.y, localPoint.z]);
    const origin = dragOriginRef.current;
    const pointerOrigin = dragPointerOriginRef.current;
    if (!origin || !pointerOrigin) return;
    const direction = dragDirectionRef.current;
    const target: [number, number, number] = [
      origin[0] + (pointerTarget[0] - pointerOrigin[0]) * direction,
      origin[1] + (pointerTarget[1] - pointerOrigin[1]) * direction,
      origin[2] + (pointerTarget[2] - pointerOrigin[2]) * direction,
    ];
    pendingDragRef.current = {
      joint,
      target,
    };
    if (!dragFrameRef.current) {
      dragFrameRef.current = window.requestAnimationFrame(() => {
        dragFrameRef.current = 0;
        const pending = pendingDragRef.current;
        pendingDragRef.current = null;
        if (pending) applyJointTarget(pending.joint, pending.target);
      });
    }
  }

  function rotateJointWithWheel(joint: PoseJointName, event: ThreeEvent<WheelEvent>) {
    event.stopPropagation();
    event.nativeEvent.preventDefault();
    const keyByJoint: Partial<Record<PoseJointName, string>> = {
      body: "body.roll",
      torso: "torso.roll",
      head: "head.roll",
      leftShoulder: "leftShoulder.twist",
      rightShoulder: "rightShoulder.twist",
      leftElbow: "leftElbow.bend",
      rightElbow: "rightElbow.bend",
      leftHand: "leftHand.twist",
      rightHand: "rightHand.twist",
      leftHip: "leftHip.twist",
      rightHip: "rightHip.twist",
      leftKnee: "leftKnee.bend",
      rightKnee: "rightKnee.bend",
      leftFoot: "leftFoot.twist",
      rightFoot: "rightFoot.twist",
    };
    const key = keyByJoint[joint];
    if (!key) return;
    const min = key.endsWith(".bend") ? 0 : -150;
    const max = key.endsWith(".bend") ? 155 : 150;
    applyControls({ [key]: clampPose((currentControls[key] ?? 0) + -event.deltaY * 0.18, min, max) });
  }

  function cancelDirectDrag() {
    if (!draggingJointRef.current) return;
    draggingJointRef.current = null;
    dragStartRef.current = null;
    dragOriginRef.current = null;
    dragPointerOriginRef.current = null;
    dragDirectionRef.current = 1;
    if (dragFrameRef.current) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = 0;
    }
    const pending = pendingDragRef.current;
    pendingDragRef.current = null;
    if (pending) applyJointTarget(pending.joint, pending.target);
    setSelectedJoint(null);
    endUndoBatch();
  }

  updateDragHandlerRef.current = updateDirectDragFromPoint;
  cancelDragHandlerRef.current = cancelDirectDrag;

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      if (!draggingJointRef.current) return;
      const rect = gl.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const pointer = new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(pointer, camera);
      updateDragHandlerRef.current(event.clientX, event.clientY, raycaster.ray);
    }
    const handleCancel = () => cancelDragHandlerRef.current();
    const handlePointerUp = () => {
      if (interactionMode === "hold") cancelDragHandlerRef.current();
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("storyai:pose-cancel", handleCancel);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("storyai:pose-cancel", handleCancel);
    };
  }, [camera, gl, interactionMode, raycaster]);

  return (
    <>
      {Object.entries(positions).map(([joint, position]) => {
        if (!position) return null;
        const name = joint as PoseJointName;
        return (
          <mesh
            key={name}
            position={toHandlePosition(position)}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (draggingJointRef.current === name) {
                cancelDirectDrag();
                return;
              }
              if (draggingJointRef.current) cancelDirectDrag();
              setSelectedJoint(name);
              const normal = camera.getWorldDirection(new Vector3());
              const worldPosition = new Vector3(...toHandlePosition(position));
              parentRef.current?.localToWorld(worldPosition);
              dragPlaneRef.current.setFromNormalAndCoplanarPoint(normal, worldPosition);
              draggingJointRef.current = name;
              dragStartRef.current = { x: event.clientX, y: event.clientY };
              dragOriginRef.current = position;
              const bodyPosition = positions.body ?? positions.torso;
              if (bodyPosition && name !== "body" && name !== "torso" && name !== "head") {
                const projectedJoint = worldPosition.clone().project(camera);
                const projectedBody = new Vector3(...toHandlePosition(bodyPosition));
                parentRef.current?.localToWorld(projectedBody);
                projectedBody.project(camera);
                dragDirectionRef.current = projectedJoint.x < projectedBody.x ? -1 : 1;
              } else {
                dragDirectionRef.current = 1;
              }
              if (event.ray.intersectPlane(dragPlaneRef.current, dragPointRef.current)) {
                const localPointer = dragPointRef.current.clone();
                parentRef.current?.worldToLocal(localPointer);
                dragPointerOriginRef.current = toBonePosition([localPointer.x, localPointer.y, localPointer.z]);
              } else {
                dragPointerOriginRef.current = position;
              }
              dragControlsRef.current = { ...currentControls };
              beginUndoBatch();
            }}
            onPointerUp={(event) => {
              if (interactionMode !== "hold") return;
              event.stopPropagation();
              cancelDirectDrag();
            }}
            onWheel={(event) => rotateJointWithWheel(name, event)}
          >
            <sphereGeometry args={[selectedJoint === name ? 0.13 : 0.09, 16, 12]} />
            <meshBasicMaterial color={TERMINAL_JOINTS.has(name) ? "#17c3ff" : "#ffd166"} depthTest={false} />
          </mesh>
        );
      })}
    </>
  );
}

function ObjectSceneNode({
  asset,
  item,
  selected,
  showLabels,
  transformMode,
  transformable,
  translationSnap,
  onSelect,
  onPoseControlChange,
  poseHandleInteractionMode,
  children,
}: {
  asset?: DirectorAssetRef;
  item: DirectorObject;
  selected: boolean;
  showLabels: boolean;
  transformMode: TransformMode;
  transformable: boolean;
  translationSnap: number | null;
  onSelect?: (item: DirectorObject) => void;
  onPoseControlChange?: (characterId: string, controls: Record<string, number>) => void;
  poseHandleInteractionMode: "persistent" | "hold";
  children?: ReactNode;
}) {
  const groupRef = useRef<Group>(null!);
  const [measuredCharacterLabel, setMeasuredCharacterLabel] = useState<{
    key: string;
    y: number;
  } | null>(null);
  const [jointPositions, setJointPositions] = useState<PoseJointPositions>({});
  const updateObjectTransform = useDirectorStore((state) => state.updateObjectTransform);
  const poseEditMode = useDirectorStore((state) => state.poseEditMode);
  const motionClips = useDirectorStore((state) => state.project.characterMotionClips ?? []);
  const motionClip = item.characterActionTrack?.motionClipId
    ? motionClips.find((clip) => clip.id === item.characterActionTrack?.motionClipId)
    : undefined;
  const animatedCharacter = useAnimatedCharacterRigState(item, motionClip);
  const editingPose = poseEditMode && selected && item.characterRig?.rigType === "ue4-mannequin" && !item.assetRefId;
  const visibleRigState = editingPose ? item.characterRig : animatedCharacter.rigState;
  const visibleRootOffset: [number, number, number] = editingPose ? [0, 0, 0] : animatedCharacter.rootOffset;
  const isImportedModel = asset?.sourceType === "model";
  const characterLabelKey = `${item.id}:${item.bodyType ?? ""}:${item.characterRig?.rigType ?? ""}`;
  const fallbackCharacterLabelY =
    item.kind === "character"
      ? item.characterRig?.rigType === "ue4-mannequin"
        ? getUE4GroundedLabelY(item.bodyType)
        : getGroundedLabelY(item.bodyType)
      : 1.25;
  const characterLabelY =
    measuredCharacterLabel?.key === characterLabelKey ? measuredCharacterLabel.y : fallbackCharacterLabelY;
  const handleCharacterLabelAnchorYChange = useCallback(
    (anchorY: number) => {
      setMeasuredCharacterLabel((current) => {
        const nextY = Number(anchorY.toFixed(4));

        if (current?.key === characterLabelKey && Math.abs(current.y - nextY) < 0.0001) {
          return current;
        }

        return {
          key: characterLabelKey,
          y: nextY,
        };
      });
    },
    [characterLabelKey]
  );
  const handleJointPositionsChange = useCallback((positions: Record<string, [number, number, number]>) => {
    setJointPositions((current) => {
      const previous = JSON.stringify(current);
      const next = JSON.stringify(positions);
      return previous === next ? current : (positions as PoseJointPositions);
    });
  }, []);

  function commitTransformFromViewport() {
    const group = groupRef.current;
    if (!group) return;

    updateObjectTransform(item.id, {
      position: [group.position.x, group.position.y, group.position.z],
      rotation: [group.rotation.x, group.rotation.y, group.rotation.z],
      scale: [group.scale.x, group.scale.y, group.scale.z],
    });
  }

  const pivot = item.pivot ?? [0, 0, 0];
  const node = (
    <group
      ref={groupRef}
      position={item.transform.position}
      rotation={item.transform.rotation}
      scale={item.transform.scale}
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.(item);
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (poseEditMode && selected) {
          window.dispatchEvent(new Event("storyai:pose-cancel"));
        }
        onSelect?.(item);
      }}
    >
      {item.objectAnimationTrack?.enabled ? <ObjectAnimationRig item={item} targetRef={groupRef} /> : null}
      <group position={[-pivot[0], -pivot[1], -pivot[2]]}>
      {isImportedModel && asset ? (
        <ImportedModelBoundary key={`${asset.id}:${asset.url}`} fallback={<ImportedModelFallback color={item.color} />}>
          <Suspense fallback={<ImportedModelFallback color={item.color} />}>
            <ImportedModel
              animated={asset.animated}
              animationDuration={item.characterActionTrack ? getActionTrackDuration(item.characterActionTrack) : undefined}
              animationElapsed={item.characterActionTrack?.enabled ? animatedCharacter.elapsed : undefined}
              color={item.color}
              fileName={asset.fileName}
              url={asset.url}
            />
          </Suspense>
        </ImportedModelBoundary>
      ) : item.kind === "character" ? (
        <>
          <group position={visibleRootOffset}>
            <Suspense fallback={null}>
              <CharacterModel
                bodyType={item.bodyType}
                color={item.color}
                onJointPositionsChange={editingPose ? handleJointPositionsChange : undefined}
                onLabelAnchorYChange={handleCharacterLabelAnchorYChange}
                rigState={visibleRigState}
              />
            </Suspense>
          </group>
          {showLabels ? (
            <ViewportObjectLabel position={[0, characterLabelY, 0]}>{item.name}</ViewportObjectLabel>
          ) : null}
          {editingPose ? (
            <PoseEditHandles
              interactionMode={poseHandleInteractionMode}
              item={item}
              positions={jointPositions}
              parentRef={groupRef}
              rootOffset={visibleRootOffset}
              onPoseControlChange={onPoseControlChange}
            />
          ) : null}
        </>
      ) : item.kind === "prop" && item.geometryType ? (
        <GeometryPrimitiveModel color={item.color} geometryType={item.geometryType} />
      ) : null}
      </group>
      {children}
    </group>
  );

  if (!selected || !transformable || (poseEditMode && item.characterRig?.rigType === "ue4-mannequin" && !item.assetRefId)) return node;

  return (
    <>
      {node}
      <ViewportTransformControls
        mode={transformMode}
        object={groupRef}
        onObjectChange={commitTransformFromViewport}
        translationSnap={transformMode === "translate" ? translationSnap : null}
      />
    </>
  );
}

function ObjectAnimationRig({ item, targetRef }: { item: DirectorObject; targetRef: MutableRefObject<Group> }) {
  useFrame(() => {
    const group = targetRef.current;
    if (!item.objectAnimationTrack?.enabled || !group) return;
    const sampled = sampleObjectAnimation(item.objectAnimationTrack, getObjectAnimationElapsed(item), item.transform);
    group.position.set(...sampled.position);
    group.rotation.set(...sampled.rotation);
    group.scale.set(...sampled.scale);
  });
  return null;
}

function CrowdTransformRig({
  crowdId,
  objects,
  selected,
  transformMode,
  transformable,
  translationSnap,
}: {
  crowdId: string;
  objects: DirectorObject[];
  selected: boolean;
  transformMode: TransformMode;
  transformable: boolean;
  translationSnap: number | null;
}) {
  const groupRef = useRef<Group>(null!);
  const updateCrowdTransform = useDirectorStore((state) => state.updateCrowdTransform);
  const crowdAnchor = useMemo(() => getCrowdAnchorTransform(objects, crowdId), [objects, crowdId]);

  function commitCrowdTransformFromViewport() {
    const group = groupRef.current;
    if (!group) return;

    updateCrowdTransform(crowdId, {
      position: [group.position.x, group.position.y, group.position.z],
      rotation: [group.rotation.x, group.rotation.y, group.rotation.z],
      scale: [group.scale.x, group.scale.y, group.scale.z],
    });
  }

  if (!selected || !transformable || !crowdAnchor) return null;

  return (
    <>
      <group
        ref={groupRef}
        position={crowdAnchor.position}
        rotation={crowdAnchor.rotation}
        scale={crowdAnchor.scale}
      />
      <ViewportTransformControls
        mode={transformMode}
        object={groupRef}
        onObjectChange={commitCrowdTransformFromViewport}
        translationSnap={transformMode === "translate" ? translationSnap : null}
      />
    </>
  );
}

export function getViewportCameraFrustumLines(
  _camera: DirectorCameraShot
): Array<[[number, number, number], [number, number, number]]> {
  const frameDepth = VIEWPORT_CAMERA_FRUSTUM_DEPTH;
  const halfWidth = VIEWPORT_CAMERA_FRUSTUM_FRAME_WIDTH / 2;
  const halfHeight = VIEWPORT_CAMERA_FRUSTUM_FRAME_WIDTH / VIEWPORT_CAMERA_ASPECT / 2;
  const topLeft: [number, number, number] = [-halfWidth, halfHeight, frameDepth];
  const topRight: [number, number, number] = [halfWidth, halfHeight, frameDepth];
  const bottomRight: [number, number, number] = [halfWidth, -halfHeight, frameDepth];
  const bottomLeft: [number, number, number] = [-halfWidth, -halfHeight, frameDepth];

  return [
    [VIEWPORT_CAMERA_LENS_TIP, topLeft],
    [VIEWPORT_CAMERA_LENS_TIP, topRight],
    [VIEWPORT_CAMERA_LENS_TIP, bottomRight],
    [VIEWPORT_CAMERA_LENS_TIP, bottomLeft],
    [topLeft, topRight],
    [topRight, bottomRight],
    [bottomRight, bottomLeft],
    [bottomLeft, topLeft],
  ];
}

function ViewportCameraRig({
  camera,
  object,
  selected,
  showLabel,
  transformMode,
  transformable,
  translationSnap,
}: {
  camera: DirectorCameraShot;
  object?: DirectorObject;
  selected: boolean;
  showLabel: boolean;
  transformMode: TransformMode;
  transformable: boolean;
  translationSnap: number | null;
}) {
  const groupRef = useRef<Group>(null!);
  const selectObject = useDirectorStore((state) => state.selectObject);
  const updateCamera = useDirectorStore((state) => state.updateCamera);
  const bodyWireframeLines = useMemo(() => getViewportCameraBodyWireframeLines(), []);
  const cameraHitArea = useMemo(() => getViewportCameraHitArea(), []);
  const cameraLabelY = useMemo(() => getViewportCameraLabelY(), []);
  const frustumLines = useMemo(() => getViewportCameraFrustumLines(camera), [camera]);
  const cameraQuaternion = useMemo(
    () => getViewportCameraQuaternion(camera.transform.position, camera.target),
    [camera.target, camera.transform.position]
  );

  useLayoutEffect(() => {
    groupRef.current?.quaternion?.copy?.(cameraQuaternion);
  }, [cameraQuaternion]);

  function commitCameraTransformFromViewport() {
    const group = groupRef.current;
    if (!group) return;

    const position: [number, number, number] = [group.position.x, group.position.y, group.position.z];
    const forward = VIEWPORT_CAMERA_FORWARD.clone().applyQuaternion(group.quaternion).normalize();
    const currentDistance = new Vector3(...camera.target).distanceTo(group.position);
    const nextTarget = group.position.clone().add(forward.multiplyScalar(Math.max(currentDistance, 0.1)));

    updateCamera(camera.id, {
      transform: {
        position,
        rotation: [group.rotation.x, group.rotation.y, group.rotation.z],
        scale: [group.scale.x, group.scale.y, group.scale.z],
      },
      target: [nextTarget.x, nextTarget.y, nextTarget.z],
    });
  }

  function selectCameraFromViewport(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    selectObject(object?.id ?? null);
  }

  const node = (
    <group
      ref={groupRef}
      position={camera.transform.position}
      quaternion={cameraQuaternion}
      scale={object?.transform.scale ?? [1, 1, 1]}
      userData={{ [HIDE_FROM_VIEWPORT_CAPTURE_KEY]: true }}
      onClick={selectCameraFromViewport}
    >
      {showLabel ? (
        <ViewportObjectLabel position={[0, cameraLabelY, 0]}>{camera.name}</ViewportObjectLabel>
      ) : null}

      <mesh name={`${camera.id}-hit-area`} onClick={selectCameraFromViewport} position={cameraHitArea.position}>
        <boxGeometry args={cameraHitArea.args} />
        <meshBasicMaterial depthWrite={false} opacity={0} transparent />
      </mesh>

      {bodyWireframeLines.map((line, index) => (
        <Line
          key={`${camera.id}-${line.part}-${index}`}
          color={VIEWPORT_CAMERA_LINE}
          lineWidth={1}
          name={`${camera.id}-${line.part}-${index}`}
          onClick={selectCameraFromViewport}
          opacity={VIEWPORT_CAMERA_LINE_OPACITY}
          points={line.points}
          transparent
        />
      ))}

      {frustumLines.map((points, index) => (
        <Line
          key={`${camera.id}-frustum-${index}`}
          color={VIEWPORT_CAMERA_LINE}
          lineWidth={1}
          name={`${camera.id}-viewfinder-${index}`}
          onClick={selectCameraFromViewport}
          opacity={VIEWPORT_CAMERA_LINE_OPACITY}
          points={points}
          transparent
        />
      ))}
    </group>
  );

  if (!selected || !transformable) return node;

  return (
    <>
      {node}
      <ViewportTransformControls
        mode={transformMode}
        object={groupRef}
        onObjectChange={commitCameraTransformFromViewport}
        translationSnap={transformMode === "translate" ? translationSnap : null}
      />
    </>
  );
}

export function SceneRoot({
  showCameraRigs = true,
  showGround = true,
  showOnlyCharacters = false,
  focusCharacterId,
  onPoseControlChange,
  poseHandleInteractionMode = "persistent",
}: {
  showCameraRigs?: boolean;
  showGround?: boolean;
  showOnlyCharacters?: boolean;
  focusCharacterId?: string | null;
  onPoseControlChange?: (characterId: string, controls: Record<string, number>) => void;
  poseHandleInteractionMode?: "persistent" | "hold";
} = {}) {
  const scene = useDirectorStore((state) => state.project.scene);
  const assets = useDirectorStore((state) => state.project.assets);
  const objects = useDirectorStore((state) => state.project.objects);
  const cameras = useDirectorStore((state) => state.project.cameras);
  const panoramaAssetId = useDirectorStore((state) => state.project.panoramaAssetId);
  const viewMode = useDirectorStore((state) => state.viewMode);
  const selectedObjectId = useDirectorStore((state) => state.selectedObjectId);
  const selectedCrowdId = useDirectorStore((state) => state.selectedCrowdId);
  const transformMode = useDirectorStore((state) => state.transformMode);
  const selectObject = useDirectorStore((state) => state.selectObject);
  const selectCrowd = useDirectorStore((state) => state.selectCrowd);
  const panoramaAsset = assets.find((item) => item.id === panoramaAssetId);
  const translationSnap = scene.snapToGrid ? 1 : null;
  const assetsById = useMemo(() => new Map(assets.map((item) => [item.id, item])), [assets]);
  const cameraObjectsByCameraId = useMemo(() => {
    return new Map(
      objects
        .filter((item) => item.kind === "camera" && item.linkedCameraId)
        .map((item) => [item.linkedCameraId as string, item])
    );
  }, [objects]);
  const crowdLocksById = useMemo(() => {
    const result = new Map<string, boolean>();
    const crowdMembers = objects.filter((item) => item.kind === "character" && item.crowdId);

    crowdMembers.forEach((item) => {
      const crowdId = item.crowdId as string;
      result.set(crowdId, (result.get(crowdId) ?? false) || item.locked);
    });

    return result;
  }, [objects]);
  const childObjectsByParentId = useMemo(() => {
    const result = new Map<string, DirectorObject[]>();
    objects.forEach((item) => {
      if (!item.parentId || item.kind === "camera") return;
      const children = result.get(item.parentId) ?? [];
      children.push(item);
      result.set(item.parentId, children);
    });
    return result;
  }, [objects]);

  function handleObjectSelect(item: DirectorObject) {
    if (item.kind === "character" && item.crowdId) {
      selectCrowd(item.crowdId);
      return;
    }

    selectObject(item.id);
  }

  function renderObjectNode(item: DirectorObject, ancestors = new Set<string>()): ReactNode {
    if (!item.visible || item.kind === "camera" || ancestors.has(item.id)) return null;
    if (showOnlyCharacters && item.kind !== "character") return null;
    if (focusCharacterId && item.id !== focusCharacterId) return null;
    const asset = item.assetRefId ? assetsById.get(item.assetRefId) : undefined;
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(item.id);
    const children = childObjectsByParentId.get(item.id) ?? [];

    return (
      <ObjectSceneNode
        key={item.id}
        asset={asset}
        item={item}
        selected={item.crowdId ? false : item.id === selectedObjectId}
        showLabels={scene.showLabels}
        transformMode={transformMode}
        transformable={!item.locked}
        translationSnap={translationSnap}
        onSelect={handleObjectSelect}
        onPoseControlChange={onPoseControlChange}
        poseHandleInteractionMode={poseHandleInteractionMode}
      >
        {children.map((child) => renderObjectNode(child, nextAncestors))}
      </ObjectSceneNode>
    );
  }

  const renderableObjects = objects.filter(
    (item) => item.kind !== "camera" && (!item.parentId || !objects.some((candidate) => candidate.id === item.parentId))
  );
  const isolatedCharacterObjects = objects.filter(
    (item) => item.kind === "character" && (!focusCharacterId || item.id === focusCharacterId)
  );

  return (
    <group
      position={scene.position}
      rotation={scene.rotation}
      scale={[scene.scale, scene.scale, scene.scale]}
    >
      {showGround && scene.showGround ? (
        <mesh position={[0, scene.groundHeight, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[200, 200]} />
          <meshBasicMaterial
            color="#303640"
            opacity={getEffectiveGroundOpacity(scene.groundOpacity, Boolean(panoramaAsset))}
            polygonOffset
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
            transparent
          />
        </mesh>
      ) : null}
      {(showOnlyCharacters || focusCharacterId ? isolatedCharacterObjects : renderableObjects).map((item) =>
        renderObjectNode(item)
      )}
      {Array.from(new Set(objects.map((item) => item.crowdId).filter((item): item is string => typeof item === "string"))).map(
        (crowdId) => (
          <CrowdTransformRig
            key={crowdId}
            crowdId={crowdId}
            objects={objects}
            selected={selectedCrowdId === crowdId}
            transformMode={transformMode}
            transformable={!(crowdLocksById.get(crowdId) ?? false)}
            translationSnap={translationSnap}
          />
        )
      )}
      {showCameraRigs && viewMode === "director"
        ? cameras
            .map((camera) => ({ camera, object: cameraObjectsByCameraId.get(camera.id) }))
            .filter(({ object }) => object?.visible ?? true)
            .map(({ camera, object }) => (
              <ViewportCameraRig
                key={camera.id}
                camera={camera}
                object={object}
                selected={object?.id === selectedObjectId}
                showLabel={scene.showLabels}
                transformMode={transformMode}
                transformable={Boolean(object && !object.locked)}
                translationSnap={translationSnap}
              />
            ))
        : null}
    </group>
  );
}
