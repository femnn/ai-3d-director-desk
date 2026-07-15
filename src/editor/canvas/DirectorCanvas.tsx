import { Grid, Line, OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { Euler, Matrix4, PerspectiveCamera as ThreePerspectiveCamera, Quaternion, Spherical, Vector3 } from "three";
import type { Object3D } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { clearViewportCaptureHandler, setViewportCaptureHandler } from "../io/captureBridge";
import { buildScreenshotMeta, type ScreenshotResult } from "../io/screenshotExport";
import { useDirectorStore, type CameraShotSnapshot } from "../store/directorStore";
import { DEFAULT_DIRECTOR_CAMERA_VIEW_SNAPSHOT, getCameraViewSnapshotFromShot } from "../schema/cameraGeometry";
import type { DirectorObject, DirectorTransform, SceneSettings } from "../schema/directorProject";
import { getGroundedLabelY } from "../runtime/mannequin/bodyTypes";
import { getUE4GroundedLabelY } from "../runtime/ue4Mannequin/ue4MannequinRig";
import { SceneRoot } from "./SceneRoot";
import { StudioSceneLights } from "./StudioSceneLights";
import { ViewportAspectOverlay } from "./ViewportAspectOverlay";
import { ViewportBackground } from "./ViewportBackground";
import { ViewportToolbar } from "./ViewportToolbar";
import { getViewportAspectFrameRect, type ViewportSafeAreaInsets } from "./viewportAspectFrame";
import { useLiveVideoCaptureActive, usePhoneCameraPath } from "../phone/phoneCameraControl";
import { CameraMonitor } from "./CameraMonitor";
import { AnimationTimeline } from "../animation/AnimationTimeline";

export const DEFAULT_DIRECTOR_VIEW_SNAPSHOT: CameraShotSnapshot = DEFAULT_DIRECTOR_CAMERA_VIEW_SNAPSHOT;
const VIEWPORT_FRAME_PADDING = 40;
const VIEWPORT_TOOLBAR_BOTTOM_OFFSET = 40;
const DEFAULT_VIEWPORT_TOOLBAR_HEIGHT = 44;
const GIZMO_HIT_LAYER_SIZE = 80;
const GIZMO_HIT_LAYER_CENTER = GIZMO_HIT_LAYER_SIZE / 2;
const GIZMO_AXIS_SCREEN_RADIUS = 25;
const GIZMO_AXIS_HIT_SIZE = 15;
const LEFT_PANEL_WIDTH = 220;
const RIGHT_PANEL_WIDTH = 300;
const GIZMO_EDGE_PADDING = 20;
const HIDE_FROM_VIEWPORT_CAPTURE_KEY = "hideFromViewportCapture";
const CAPTURE_LABEL_FONT_SIZE = 12;
const CAPTURE_LABEL_HORIZONTAL_PADDING = 10;
const CAPTURE_LABEL_VERTICAL_PADDING = 6;
const CAPTURE_LABEL_BORDER_RADIUS = 999;
const CAPTURE_LABEL_PANEL_RGB_FALLBACK = "26 26 26";
const CAPTURE_LABEL_TEXT_RGB_FALLBACK = "255 255 255";
const VIEWPORT_GRID_ELEVATION = 0.002;
const GIZMO_AXIS_HIT_TARGETS: Array<{
  label: string;
  className: string;
  direction: [number, number, number];
}> = [
  { label: "切换到 X 正向视图", className: "is-x-positive", direction: [1, 0, 0] },
  { label: "切换到 Y 正向视图", className: "is-y-positive", direction: [0, 1, 0] },
  { label: "切换到 Z 正向视图", className: "is-z-positive", direction: [0, 0, 1] },
  { label: "切换到 X 反向视图", className: "is-x-negative", direction: [-1, 0, 0] },
  { label: "切换到 Y 反向视图", className: "is-y-negative", direction: [0, -1, 0] },
  { label: "切换到 Z 反向视图", className: "is-z-negative", direction: [0, 0, -1] },
];
type ViewportCaptureLabel = {
  text: string;
  worldPosition: Vector3;
};
type ViewportCaptureFrameRect = NonNullable<ReturnType<typeof getViewportAspectFrameRect>>;

export function shouldRenderViewportGrid(hasPanorama: boolean, snapToGrid: boolean) {
  return true;
}

export function getViewportSnapshotFromGizmoDirection(
  snapshot: CameraShotSnapshot,
  direction: Vector3
): CameraShotSnapshot {
  const target = new Vector3(...snapshot.target);
  const currentPosition = new Vector3(...snapshot.position);
  const radius = Math.max(currentPosition.distanceTo(target), 0.000001);
  const nextDirection = direction.lengthSq() === 0 ? new Vector3(0, 0, 1) : direction.clone().normalize();
  const nextPosition = target.clone().add(nextDirection.multiplyScalar(radius));

  return {
    fov: snapshot.fov,
    position: toSnapshotTuple(nextPosition),
    target: snapshot.target,
  };
}

export function getViewportGizmoHitButtonStyle(
  snapshot: CameraShotSnapshot,
  direction: [number, number, number]
): CSSProperties {
  const relativeCamera = new Vector3(...snapshot.position).sub(new Vector3(...snapshot.target));
  const camera = new ThreePerspectiveCamera(snapshot.fov, 1);
  const safeCameraPosition = relativeCamera.lengthSq() === 0 ? new Vector3(0, 0, 1) : relativeCamera;
  camera.position.copy(safeCameraPosition);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  const gizmoQuaternion = new Quaternion().setFromRotationMatrix(new Matrix4().copy(camera.matrix).invert());
  const projectedDirection = new Vector3(...direction).applyQuaternion(gizmoQuaternion);
  const left = GIZMO_HIT_LAYER_CENTER + projectedDirection.x * GIZMO_AXIS_SCREEN_RADIUS - GIZMO_AXIS_HIT_SIZE / 2;
  const top = GIZMO_HIT_LAYER_CENTER - projectedDirection.y * GIZMO_AXIS_SCREEN_RADIUS - GIZMO_AXIS_HIT_SIZE / 2;

  return {
    left: `${Number(left.toFixed(3))}px`,
    top: `${Number(top.toFixed(3))}px`,
    zIndex: Math.round((projectedDirection.z + 1) * 100),
  };
}

function toSnapshotTuple(vector: Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z].map((value) => Number(value.toFixed(6))) as [number, number, number];
}

function areCameraSnapshotsClose(a: CameraShotSnapshot, b: CameraShotSnapshot) {
  const tupleClose = (left: [number, number, number], right: [number, number, number]) =>
    left.every((value, index) => Math.abs(value - right[index]) < 0.00001);

  return Math.abs(a.fov - b.fov) < 0.00001 && tupleClose(a.position, b.position) && tupleClose(a.target, b.target);
}

function applySnapshotToCamera(camera: ThreePerspectiveCamera, snapshot: CameraShotSnapshot) {
  camera.fov = snapshot.fov;
  camera.position.set(...snapshot.position);
  camera.lookAt(...snapshot.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

function createTransformMatrix(transform: DirectorTransform) {
  return new Matrix4().compose(
    new Vector3(...transform.position),
    new Quaternion().setFromEuler(new Euler(...transform.rotation)),
    new Vector3(...transform.scale)
  );
}

function createSceneMatrix(scene: SceneSettings) {
  return new Matrix4().compose(
    new Vector3(...scene.position),
    new Quaternion().setFromEuler(new Euler(...scene.rotation)),
    new Vector3(scene.scale, scene.scale, scene.scale)
  );
}

function getCharacterCaptureLabelY(item: DirectorObject) {
  return item.characterRig?.rigType === "ue4-mannequin"
    ? getUE4GroundedLabelY(item.bodyType)
    : getGroundedLabelY(item.bodyType);
}

function getViewportCaptureLabels() {
  const {
    project: { objects, scene },
  } = useDirectorStore.getState();

  if (!scene.showLabels) return [];

  const sceneMatrix = createSceneMatrix(scene);

  return objects
    .filter((item) => item.kind === "character" && item.visible)
    .map((item): ViewportCaptureLabel => {
      const objectMatrix = createTransformMatrix(item.transform);
      const worldPosition = new Vector3(0, getCharacterCaptureLabelY(item), 0)
        .applyMatrix4(objectMatrix)
        .applyMatrix4(sceneMatrix);

      return {
        text: item.name,
        worldPosition,
      };
    });
}

function getCssRgbVariable(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;

  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function rgbTripletToRgba(rgbTriplet: string, alpha: number) {
  const [red = "0", green = "0", blue = "0"] = rgbTriplet.split(/\s+/);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function drawViewportCaptureLabels({
  camera,
  context,
  frameRect,
  heightScale,
  labels,
  viewportHeight,
  viewportWidth,
  widthScale,
}: {
  camera: ThreePerspectiveCamera;
  context: CanvasRenderingContext2D;
  frameRect: ViewportCaptureFrameRect;
  heightScale: number;
  labels: ViewportCaptureLabel[];
  viewportHeight: number;
  viewportWidth: number;
  widthScale: number;
}) {
  const drawingContext = context as CanvasRenderingContext2D & {
    fillText?: CanvasRenderingContext2D["fillText"];
    measureText?: CanvasRenderingContext2D["measureText"];
  };

  if (labels.length === 0 || !drawingContext.fillText || !drawingContext.measureText) return;

  const pixelScale = Math.max((widthScale + heightScale) / 2, 0.0001);
  const fontSize = CAPTURE_LABEL_FONT_SIZE * pixelScale;
  const horizontalPadding = CAPTURE_LABEL_HORIZONTAL_PADDING * pixelScale;
  const verticalPadding = CAPTURE_LABEL_VERTICAL_PADDING * pixelScale;
  const labelHeight = fontSize + verticalPadding * 2;
  const panelRgb = getCssRgbVariable("--panel-rgb", CAPTURE_LABEL_PANEL_RGB_FALLBACK);
  const textRgb = getCssRgbVariable("--text-rgb", CAPTURE_LABEL_TEXT_RGB_FALLBACK);

  context.font = `${fontSize}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";

  labels.forEach((label) => {
    const projected = label.worldPosition.clone().project(camera);
    if (projected.z < -1 || projected.z > 1) return;

    const viewportX = (projected.x * 0.5 + 0.5) * viewportWidth;
    const viewportY = (-projected.y * 0.5 + 0.5) * viewportHeight;
    const x = (viewportX - frameRect.left) * widthScale;
    const y = (viewportY - frameRect.top) * heightScale;
    const textWidth = context.measureText(label.text).width;
    const labelWidth = textWidth + horizontalPadding * 2;
    const labelX = x - labelWidth / 2;
    const labelY = y - labelHeight / 2;

    if (labelX > frameRect.width * widthScale || labelY > frameRect.height * heightScale) return;
    if (labelX + labelWidth < 0 || labelY + labelHeight < 0) return;

    context.fillStyle = rgbTripletToRgba(panelRgb, 0.92);
    drawRoundedRect(context, labelX, labelY, labelWidth, labelHeight, CAPTURE_LABEL_BORDER_RADIUS * pixelScale);
    context.fill();
    context.fillStyle = rgbTripletToRgba(textRgb, 1);
    context.fillText(label.text, x, y);
  });
}

function captureViewportCanvas(
  canvas: HTMLCanvasElement,
  aspectRatio: ReturnType<typeof useDirectorStore.getState>["viewportAspectRatio"],
  bottomPadding: number,
  safeAreaInsets?: ViewportSafeAreaInsets,
  captureLabels?: {
    camera: ThreePerspectiveCamera;
    labels: ViewportCaptureLabel[];
  }
) {
  const viewportWidth = canvas.clientWidth || canvas.width;
  const viewportHeight = canvas.clientHeight || canvas.height;
  const frameRect = getViewportAspectFrameRect(
    aspectRatio,
    viewportWidth,
    viewportHeight,
    bottomPadding,
    safeAreaInsets
  );
  const labels = captureLabels?.labels ?? [];

  if (!frameRect && labels.length === 0) {
    return canvas.toDataURL("image/png");
  }

  const exportFrameRect = frameRect ?? {
    left: 0,
    top: 0,
    width: viewportWidth,
    height: viewportHeight,
  };
  const widthScale = canvas.width / Math.max(viewportWidth, 1);
  const heightScale = canvas.height / Math.max(viewportHeight, 1);
  const sourceX = Math.round(exportFrameRect.left * widthScale);
  const sourceY = Math.round(exportFrameRect.top * heightScale);
  const sourceWidth = Math.max(Math.round(exportFrameRect.width * widthScale), 1);
  const sourceHeight = Math.max(Math.round(exportFrameRect.height * heightScale), 1);
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = sourceWidth;
  cropCanvas.height = sourceHeight;
  let context: CanvasRenderingContext2D | null = null;

  try {
    context = cropCanvas.getContext("2d");
  } catch {
    return canvas.toDataURL("image/png");
  }

  if (!context) {
    return canvas.toDataURL("image/png");
  }

  context.drawImage(canvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
  if (captureLabels) {
    drawViewportCaptureLabels({
      camera: captureLabels.camera,
      context,
      frameRect: exportFrameRect,
      heightScale,
      labels,
      viewportHeight,
      viewportWidth,
      widthScale,
    });
  }
  return cropCanvas.toDataURL("image/png");
}

function withViewportCaptureHelpersHidden(scene: Object3D, render: () => void) {
  const hiddenObjects: Array<{ object: Object3D; visible: boolean }> = [];

  scene.traverse((object) => {
    if (object.userData?.[HIDE_FROM_VIEWPORT_CAPTURE_KEY]) {
      hiddenObjects.push({ object, visible: object.visible });
      object.visible = false;
    }
  });

  try {
    render();
  } finally {
    hiddenObjects.forEach(({ object, visible }) => {
      object.visible = visible;
    });
  }
}

function CanvasCaptureBridge({
  activeCamera,
  bottomPadding,
  controlsRef,
  safeAreaInsets,
  viewportAspectRatio,
  viewMode,
}: {
  activeCamera:
    | {
        id: string;
        fov: number;
        target: [number, number, number];
      }
    | undefined;
  bottomPadding: number;
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
  safeAreaInsets: ViewportSafeAreaInsets;
  viewportAspectRatio: ReturnType<typeof useDirectorStore.getState>["viewportAspectRatio"];
  viewMode: "director" | "camera";
}) {
  const { camera, gl, scene } = useThree();

  useEffect(() => {
    const workingCamera = camera as ThreePerspectiveCamera;

    const capture = async ({
      cameraId,
      preset,
      source,
    }: {
      cameraId?: string | null;
      preset: "current" | "four" | "twelve";
      source: "capture-panel" | "camera-panel";
    }): Promise<ScreenshotResult[]> => {
      const target = new Vector3(0, 1.2, 0);
      if (viewMode === "camera" && activeCamera) {
        target.fromArray(activeCamera.target);
      } else if (controlsRef.current?.target) {
        target.copy(controlsRef.current.target);
      }

      const originalPosition = workingCamera.position.clone();
      const originalQuaternion = workingCamera.quaternion.clone();
      const originalFov = workingCamera.fov;

      const snapshot = (label: string) => {
        withViewportCaptureHelpersHidden(scene, () => {
          gl.render(scene, workingCamera);
        });
        return {
          label,
          dataUrl: captureViewportCanvas(gl.domElement, viewportAspectRatio, bottomPadding, safeAreaInsets, {
            camera: workingCamera,
            labels: getViewportCaptureLabels(),
          }),
          meta: buildScreenshotMeta({
            mode: viewMode,
            cameraId: cameraId ?? (viewMode === "camera" ? activeCamera?.id ?? null : null),
            fov: workingCamera.fov,
            position: [workingCamera.position.x, workingCamera.position.y, workingCamera.position.z],
            target: [target.x, target.y, target.z],
          }),
        };
      };

      if (preset === "current") {
        return [snapshot(source === "camera-panel" ? "当前机位" : "当前视角")];
      }

      const count = preset === "four" ? 4 : 12;
      const labelPrefix = preset === "four" ? "四方位" : "十二方位";
      const offset = originalPosition.clone().sub(target);
      const spherical = new Spherical().setFromVector3(offset.lengthSq() === 0 ? new Vector3(0, 0, 6) : offset);
      const phi = Math.min(Math.max(spherical.phi, 0.35), Math.PI - 0.35);
      const radius = spherical.radius || 6;

      try {
        const results: ScreenshotResult[] = [];
        for (let index = 0; index < count; index += 1) {
          const orbit = new Spherical(radius, phi, spherical.theta + (Math.PI * 2 * index) / count);
          const nextPosition = target.clone().add(new Vector3().setFromSpherical(orbit));
          workingCamera.position.copy(nextPosition);
          workingCamera.lookAt(target);
          workingCamera.updateProjectionMatrix();
          results.push(snapshot(`${labelPrefix} ${index + 1}`));
        }
        return results;
      } finally {
        workingCamera.position.copy(originalPosition);
        workingCamera.quaternion.copy(originalQuaternion);
        workingCamera.fov = originalFov;
        workingCamera.updateProjectionMatrix();
        gl.render(scene, workingCamera);
      }
    };

    setViewportCaptureHandler(capture);
    return () => clearViewportCaptureHandler();
  }, [activeCamera, bottomPadding, camera, controlsRef, gl, safeAreaInsets, scene, viewMode, viewportAspectRatio]);

  return null;
}

function DirectorViewCameraSync({
  controlsRef,
  snapshot,
  viewMode,
}: {
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
  snapshot: CameraShotSnapshot;
  viewMode: "director" | "camera";
}) {
  const { camera } = useThree();

  useLayoutEffect(() => {
    if (viewMode !== "director") return;

    const perspectiveCamera = camera as ThreePerspectiveCamera;
    applySnapshotToCamera(perspectiveCamera, snapshot);

    if (controlsRef.current) {
      controlsRef.current.target.set(...snapshot.target);
      controlsRef.current.update();
    }
  }, [camera, controlsRef, snapshot, viewMode]);

  return null;
}

function getPoseEditorViewSnapshot(position: [number, number, number]): CameraShotSnapshot {
  return {
    fov: 35,
    position: [position[0] + 3.2, position[1] + 1.65, position[2] + 4.2],
    target: [position[0], position[1] + 1.05, position[2]],
  };
}

function PoseEditorCameraSync({ snapshot }: { snapshot: CameraShotSnapshot }) {
  const { camera } = useThree();

  useLayoutEffect(() => {
    const perspectiveCamera = camera as ThreePerspectiveCamera;
    perspectiveCamera.position.set(...snapshot.position);
    perspectiveCamera.fov = snapshot.fov;
    perspectiveCamera.lookAt(...snapshot.target);
    perspectiveCamera.updateProjectionMatrix();
    perspectiveCamera.updateMatrixWorld();
  }, [camera, snapshot]);

  return null;
}

function ViewportGizmoOverlay({
  leftOffset,
  onSnapshotChange,
  rightOffset = GIZMO_EDGE_PADDING,
  snapshot,
}: {
  leftOffset?: number;
  onSnapshotChange: (snapshot: CameraShotSnapshot) => void;
  rightOffset?: number;
  snapshot: CameraShotSnapshot;
}) {
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    snapshot: CameraShotSnapshot;
  } | null>(null);

  function rotateFromPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const target = new Vector3(...drag.snapshot.target);
    const offset = new Vector3(...drag.snapshot.position).sub(target);
    const spherical = new Spherical().setFromVector3(offset.lengthSq() ? offset : new Vector3(0, 0, 1));
    spherical.theta -= (event.clientX - drag.startX) * 0.012;
    spherical.phi = Math.min(Math.max(spherical.phi + (event.clientY - drag.startY) * 0.012, 0.08), Math.PI - 0.08);
    const position = target.clone().add(new Vector3().setFromSpherical(spherical));
    onSnapshotChange({ ...drag.snapshot, position: toSnapshotTuple(position) });
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function zoomFromWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const target = new Vector3(...snapshot.target);
    const offset = new Vector3(...snapshot.position).sub(target);
    const distance = Math.min(Math.max(offset.length() * Math.exp(event.deltaY * 0.001), 0.8), 30);
    if (offset.lengthSq() === 0) offset.set(0, 0, 1);
    onSnapshotChange({ ...snapshot, position: toSnapshotTuple(target.add(offset.normalize().multiplyScalar(distance))) });
  }

  return (
    <div
      className="viewport-gizmo-overlay"
      aria-label="3D视口原生坐标控件"
      role="application"
      style={leftOffset === undefined ? { right: `${rightOffset}px` } : { left: `${leftOffset}px`, right: "auto" }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          snapshot,
        };
      }}
      onPointerMove={rotateFromPointer}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onWheel={zoomFromWheel}
    >
      <div className="viewport-gizmo-static" aria-hidden="true">
        <span className="viewport-gizmo-center" />
        <span className="viewport-gizmo-axis-line is-x" />
        <span className="viewport-gizmo-axis-line is-y" />
        <span className="viewport-gizmo-axis-line is-z" />
      </div>
      <div className="viewport-gizmo-hit-layer" aria-hidden="true">
        {GIZMO_AXIS_HIT_TARGETS.map((target) => (
          <span
            key={target.label}
            className={`viewport-gizmo-hit-button ${target.className}`}
            style={getViewportGizmoHitButtonStyle(snapshot, target.direction)}
          >
            {target.className.includes("is-x") ? "X" : target.className.includes("is-y") ? "Y" : "Z"}
          </span>
        ))}
      </div>
    </div>
  );
}

function PhoneCameraPathLine() {
  const path = usePhoneCameraPath();
  if (path.length < 2) return null;

  return (
    <Line
      color="#FFB020"
      lineWidth={2}
      points={path}
      userData={{ [HIDE_FROM_VIEWPORT_CAPTURE_KEY]: true }}
    />
  );
}

export function DirectorCanvas() {
  const recordingVideo = useLiveVideoCaptureActive();
  const viewMode = useDirectorStore((state) => state.viewMode);
  const openSceneInspector = useDirectorStore((state) => state.openSceneInspector);
  const sceneSettings = useDirectorStore((state) => state.project.scene);
  const assets = useDirectorStore((state) => state.project.assets);
  const panoramaAssetId = useDirectorStore((state) => state.project.panoramaAssetId);
  const activeCamera = useDirectorStore((state) =>
    state.project.cameras.find((item) => item.id === state.project.activeCameraId)
  );
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const viewportCameraSnapshotRef = useRef<CameraShotSnapshot>(DEFAULT_DIRECTOR_VIEW_SNAPSHOT);
  const [directorViewSnapshot, setDirectorViewSnapshot] = useState(DEFAULT_DIRECTOR_VIEW_SNAPSHOT);
  const [poseEditorViewSnapshot, setPoseEditorViewSnapshot] = useState<CameraShotSnapshot>(DEFAULT_DIRECTOR_VIEW_SNAPSHOT);
  const [toolbarHeight, setToolbarHeight] = useState(DEFAULT_VIEWPORT_TOOLBAR_HEIGHT);
  const [animationTimelineOpen, setAnimationTimelineOpen] = useState(false);
  const hasPanorama = Boolean(panoramaAssetId);
  const panoramaAsset = assets.find((item) => item.id === panoramaAssetId);
  const showViewportGrid = sceneSettings.showGrid && shouldRenderViewportGrid(hasPanorama, sceneSettings.snapToGrid);
  const activeCameraView = activeCamera ? getCameraViewSnapshotFromShot(activeCamera) : undefined;
  const viewportAspectRatio = useDirectorStore((state) => state.viewportAspectRatio);
  const viewportRuleOfThirdsEnabled = useDirectorStore((state) => state.viewportRuleOfThirdsEnabled);
  const viewportPanelsCollapsed = useDirectorStore((state) => state.viewportPanelsCollapsed);
  const poseEditMode = useDirectorStore((state) => state.poseEditMode);
  const poseEditCharacter = useDirectorStore((state) =>
    state.poseEditMode
      ? state.project.objects.find((object) => object.id === state.selectedObjectId && object.kind === "character" && !object.assetRefId)
      : null
  );
  const setViewMode = useDirectorStore((state) => state.setViewMode);
  const setViewportRuleOfThirdsEnabled = useDirectorStore((state) => state.setViewportRuleOfThirdsEnabled);
  const visibleViewportSnapshot = poseEditCharacter
    ? poseEditorViewSnapshot
    : viewMode === "camera" && activeCameraView
      ? activeCameraView
      : directorViewSnapshot;
  const viewportSafeAreaInsets: ViewportSafeAreaInsets = viewportPanelsCollapsed
    ? { left: 0, right: 0, top: 0, bottom: 0 }
    : { left: LEFT_PANEL_WIDTH, right: RIGHT_PANEL_WIDTH, top: 0, bottom: 0 };
  const gizmoRightOffset = viewportPanelsCollapsed ? GIZMO_EDGE_PADDING : RIGHT_PANEL_WIDTH + GIZMO_EDGE_PADDING;

  useLayoutEffect(() => {
    const element = toolbarRef.current;
    if (!element) return;

    const updateHeight = () => {
      const nextHeight = Math.max(element.offsetHeight, DEFAULT_VIEWPORT_TOOLBAR_HEIGHT);
      setToolbarHeight((currentHeight) => (currentHeight === nextHeight ? currentHeight : nextHeight));
    };

    updateHeight();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateHeight);
      return () => {
        window.removeEventListener("resize", updateHeight);
      };
    }

    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(element);
    window.addEventListener("resize", updateHeight);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  useEffect(() => {
    if (!poseEditCharacter) return;
    setPoseEditorViewSnapshot(getPoseEditorViewSnapshot(poseEditCharacter.transform.position));
  }, [poseEditCharacter?.id]);

  function getViewportCameraSnapshot(): CameraShotSnapshot {
    return viewportCameraSnapshotRef.current;
  }

  function updateDirectorViewSnapshot(snapshot: CameraShotSnapshot) {
    viewportCameraSnapshotRef.current = snapshot;
    setDirectorViewSnapshot((currentSnapshot) =>
      areCameraSnapshotsClose(currentSnapshot, snapshot) ? currentSnapshot : snapshot
    );
  }

  useEffect(() => {
    const handleDirectorView = (event: Event) => {
      const snapshot = (event as CustomEvent<CameraShotSnapshot>).detail;
      if (!snapshot?.position || !snapshot?.target || !Number.isFinite(snapshot.fov)) return;
      if (viewMode !== "director") setViewMode("director");
      updateDirectorViewSnapshot(snapshot);
    };
    window.addEventListener("storyai:director-view", handleDirectorView);
    return () => window.removeEventListener("storyai:director-view", handleDirectorView);
  }, [viewMode, setViewMode]);

  function updateViewportGizmoSnapshot(snapshot: CameraShotSnapshot) {
    if (poseEditCharacter) {
      setPoseEditorViewSnapshot(snapshot);
      return;
    }
    if (viewMode !== "director") {
      setViewMode("director");
    }
    updateDirectorViewSnapshot(snapshot);
  }

  const aspectOverlayBottomPadding =
    VIEWPORT_FRAME_PADDING + VIEWPORT_TOOLBAR_BOTTOM_OFFSET + toolbarHeight;

  return (
    <div className="canvas-frame">
      <div className="director-stage">
        <div className="director-canvas" data-testid="director-canvas">
        <Canvas
          camera={{ position: DEFAULT_DIRECTOR_VIEW_SNAPSHOT.position, fov: DEFAULT_DIRECTOR_VIEW_SNAPSHOT.fov }}
          dpr={recordingVideo ? 1 : [1, 1.5]}
          frameloop={recordingVideo ? "demand" : "always"}
          gl={{ antialias: true, preserveDrawingBuffer: true }}
          onPointerMissed={() => {
            if (poseEditCharacter) {
              window.dispatchEvent(new Event("storyai:pose-cancel"));
              return;
            }
            openSceneInspector();
          }}
          onCreated={({ camera }) => {
            const perspectiveCamera = camera as ThreePerspectiveCamera;
            perspectiveCamera.lookAt(...DEFAULT_DIRECTOR_VIEW_SNAPSHOT.target);
            viewportCameraSnapshotRef.current = {
              fov: perspectiveCamera.fov,
              position: [perspectiveCamera.position.x, perspectiveCamera.position.y, perspectiveCamera.position.z],
              target: DEFAULT_DIRECTOR_VIEW_SNAPSHOT.target,
            };
            setDirectorViewSnapshot(viewportCameraSnapshotRef.current);
          }}
        >
          <ViewportBackground
            backgroundColor={poseEditCharacter ? "#10151d" : sceneSettings.backgroundColor}
            panoramaAsset={poseEditCharacter ? undefined : panoramaAsset}
            panoramaRadius={sceneSettings.panoramaRadius}
            panoramaYaw={sceneSettings.panoramaYaw}
          />
          <StudioSceneLights />
          {showViewportGrid && !poseEditCharacter ? (
            <Grid
              cellThickness={0}
              fadeDistance={80}
              infiniteGrid
              position={[0, sceneSettings.groundHeight + VIEWPORT_GRID_ELEVATION, 0]}
              sectionColor="#2A4065"
              userData={{ [HIDE_FROM_VIEWPORT_CAPTURE_KEY]: true }}
            />
          ) : null}
          {viewMode === "director" ? (
            <OrbitControls
              ref={controlsRef}
              enableDamping
              enabled={!poseEditCharacter}
              makeDefault
              target={DEFAULT_DIRECTOR_VIEW_SNAPSHOT.target}
              onChange={(event) => {
                const perspectiveCamera = event?.target?.object as ThreePerspectiveCamera | undefined;
                const target = event?.target?.target as Vector3 | undefined;
                if (!perspectiveCamera || !target) return;
                updateDirectorViewSnapshot({
                  fov: perspectiveCamera.fov,
                  position: [perspectiveCamera.position.x, perspectiveCamera.position.y, perspectiveCamera.position.z],
                  target: [target.x, target.y, target.z],
                });
              }}
            />
          ) : null}
          <DirectorViewCameraSync controlsRef={controlsRef} snapshot={directorViewSnapshot} viewMode={viewMode} />
          {poseEditCharacter ? <PoseEditorCameraSync snapshot={poseEditorViewSnapshot} /> : null}
          {viewMode === "camera" && activeCameraView ? (
            <PerspectiveCamera
              fov={activeCameraView.fov}
              makeDefault
              position={activeCameraView.position}
              onUpdate={(camera) => camera.lookAt(...activeCameraView.target)}
            />
          ) : null}
          <CanvasCaptureBridge
            activeCamera={activeCamera}
            bottomPadding={aspectOverlayBottomPadding}
            controlsRef={controlsRef}
            safeAreaInsets={viewportSafeAreaInsets}
            viewportAspectRatio={viewportAspectRatio}
            viewMode={viewMode}
          />
          <PhoneCameraPathLine />
          <Suspense fallback={null}>
            <SceneRoot focusCharacterId={poseEditCharacter?.id} />
          </Suspense>
        </Canvas>
        </div>
        <ViewportAspectOverlay
        bottomPadding={aspectOverlayBottomPadding}
        onToggleRuleOfThirds={setViewportRuleOfThirdsEnabled}
        ratio={viewportAspectRatio}
        safeAreaInsets={viewportSafeAreaInsets}
        showRuleOfThirds={viewportRuleOfThirdsEnabled}
      />
        {poseEditCharacter ? (
        <ViewportGizmoOverlay
          onSnapshotChange={updateViewportGizmoSnapshot}
          rightOffset={gizmoRightOffset}
          snapshot={visibleViewportSnapshot}
        />
      ) : null}
        {poseEditCharacter ? null : <CameraMonitor />}
        <ViewportToolbar
          animationTimelineOpen={animationTimelineOpen}
          getViewportCameraSnapshot={getViewportCameraSnapshot}
          onToggleAnimationTimeline={() => setAnimationTimelineOpen((open) => !open)}
          toolbarContainerRef={toolbarRef}
        />
      </div>
      {animationTimelineOpen ? <AnimationTimeline onClose={() => setAnimationTimelineOpen(false)} /> : null}
    </div>
  );
}
