import { Grid } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { Camera } from "lucide-react";
import { Vector3 } from "three";
import { getCameraViewSnapshotFromShot, type CameraViewSnapshot } from "../schema/cameraGeometry";
import { getViewportAspectRatioValue } from "../schema/viewportAspectRatio";
import { useDirectorStore } from "../store/directorStore";
import { SceneRoot } from "./SceneRoot";
import { StudioSceneLights } from "./StudioSceneLights";
import { ViewportBackground } from "./ViewportBackground";
import {
  registerCameraMonitorCanvas,
  requestCameraMonitorVideoFrame,
  unregisterCameraMonitorCanvas,
} from "../phone/phoneCameraControl";

const MONITOR_GRID_ELEVATION = 0.002;
const MIN_MONITOR_WIDTH = 220;
const MAX_MONITOR_WIDTH = 620;
const MONITOR_ASPECT = 16 / 9;
const MONITOR_SCREEN_MARGIN = 12;
// Keep the monitor compact in the UI while rendering its backing canvas at
// qHD quality for video capture. 960x540 at the default 320x180 monitor size
// is a useful quality increase without the 16x render cost of jumping straight
// from DPR 1 to a 1280x720 backing canvas.
const MONITOR_CAPTURE_DPR = 3;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function CameraMonitorViewCamera({ view }: { view: CameraViewSnapshot }) {
  const camera = useThree((state) => state.camera);
  const positionRef = useRef(new Vector3(...view.position));
  const targetRef = useRef(new Vector3(...view.target));
  const targetPositionRef = useRef(new Vector3(...view.position));
  const targetLookAtRef = useRef(new Vector3(...view.target));
  const fovRef = useRef(view.fov);

  useEffect(() => {
    targetPositionRef.current.set(...view.position);
    targetLookAtRef.current.set(...view.target);
  }, [view.position, view.target]);

  useFrame((_, delta) => {
    const smoothing = 1 - Math.exp(-24 * Math.min(delta, 0.1));
    positionRef.current.lerp(targetPositionRef.current, smoothing);
    targetRef.current.lerp(targetLookAtRef.current, smoothing);
    fovRef.current += (view.fov - fovRef.current) * smoothing;
    camera.position.copy(positionRef.current);
    if ("fov" in camera) {
      camera.fov = fovRef.current;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(targetRef.current);
    camera.updateMatrixWorld();
  });

  return null;
}

function CameraMonitorRenderAndCapture() {
  useFrame(({ camera, gl, scene }) => {
    gl.render(scene, camera);
    requestCameraMonitorVideoFrame(gl.domElement, performance.now());
  }, 1);

  return null;
}

export function CameraMonitor() {
  const [layout, setLayout] = useState(() => {
    const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
    const width = 320;
    return {
      x: Math.max(MONITOR_SCREEN_MARGIN, viewportWidth - 324 - width - 24),
      y: 84,
      width,
    };
  });
  const dragRef = useRef<
    | {
        mode: "move" | "resize";
        startX: number;
        startY: number;
        layout: typeof layout;
      }
    | null
  >(null);
  const recorderCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewMode = useDirectorStore((state) => state.viewMode);
  const collapsed = useDirectorStore((state) => state.cameraMonitorCollapsed);
  const setCollapsed = useDirectorStore((state) => state.setCameraMonitorCollapsed);
  const sceneSettings = useDirectorStore((state) => state.project.scene);
  const assets = useDirectorStore((state) => state.project.assets);
  const objects = useDirectorStore((state) => state.project.objects);
  const panoramaAssetId = useDirectorStore((state) => state.project.panoramaAssetId);
  const activeCamera = useDirectorStore((state) =>
    state.project.cameras.find((item) => item.id === state.project.activeCameraId)
  );
  const viewportAspectRatio = useDirectorStore((state) => state.viewportAspectRatio);

  const sceneContentKey = useMemo(
    () =>
      JSON.stringify({
        assets: assets.map((asset) => [asset.id, asset.url, asset.fileName]),
        objects: objects
          .filter((object) => object.kind !== "camera")
          .map((object) => [
            object.id,
            object.kind,
            object.assetRefId,
            object.geometryType,
            object.geometryAnchor,
            object.geometrySize,
            object.color,
            object.material,
            object.assemblyRootId,
            object.assemblySelectionMode,
            object.visible,
            object.transform,
          ]),
        panoramaAssetId,
      }),
    [assets, objects, panoramaAssetId]
  );

  useEffect(
    () => () => {
      unregisterCameraMonitorCanvas(recorderCanvasRef.current);
      recorderCanvasRef.current = null;
    },
    []
  );

  useEffect(() => {
    function handlePointerMove(event: globalThis.PointerEvent) {
      updateLayoutFromClientPoint(event.clientX, event.clientY);
    }

    function handleMouseMove(event: globalThis.MouseEvent) {
      updateLayoutFromClientPoint(event.clientX, event.clientY);
    }

    function handlePointerUp() {
      endLayoutInteraction();
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handlePointerUp);
    };
  });

  if (viewMode !== "director" || !activeCamera) return null;

  const cameraView = getCameraViewSnapshotFromShot(activeCamera);
  const panoramaAsset = assets.find((item) => item.id === panoramaAssetId);
  const monitorAspect = getViewportAspectRatioValue(viewportAspectRatio) ?? MONITOR_ASPECT;
  const height = Math.round(layout.width / monitorAspect);

  function beginInteraction(mode: "move" | "resize", clientX: number, clientY: number) {
    dragRef.current = {
      mode,
      startX: clientX,
      startY: clientY,
      layout,
    };
  }

  function beginMove(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    beginInteraction("move", event.clientX, event.clientY);
  }

  function beginMouseMove(event: MouseEvent<HTMLDivElement>) {
    beginInteraction("move", event.clientX, event.clientY);
  }

  function beginResize(event: PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    beginInteraction("resize", event.clientX, event.clientY);
  }

  function beginMouseResize(event: MouseEvent<HTMLButtonElement>) {
    beginInteraction("resize", event.clientX, event.clientY);
  }

  function updateLayoutFromClientPoint(clientX: number, clientY: number) {
    const drag = dragRef.current;
    if (!drag) return;

    const dx = clientX - drag.startX;
    const dy = clientY - drag.startY;
    if (drag.mode === "resize") {
      const nextWidth = clamp(drag.layout.width + Math.max(dx, dy * MONITOR_ASPECT), MIN_MONITOR_WIDTH, MAX_MONITOR_WIDTH);
      setLayout({ ...drag.layout, width: Math.round(nextWidth) });
      return;
    }

    const maxX = Math.max(window.innerWidth - drag.layout.width - MONITOR_SCREEN_MARGIN, MONITOR_SCREEN_MARGIN);
    const maxY = Math.max(window.innerHeight - drag.layout.width / monitorAspect - MONITOR_SCREEN_MARGIN, MONITOR_SCREEN_MARGIN);
    setLayout({
      ...drag.layout,
      x: Math.round(clamp(drag.layout.x + dx, MONITOR_SCREEN_MARGIN, maxX)),
      y: Math.round(clamp(drag.layout.y + dy, MONITOR_SCREEN_MARGIN, maxY)),
    });
  }

  function updateLayoutFromPointer(event: PointerEvent<HTMLElement>) {
    updateLayoutFromClientPoint(event.clientX, event.clientY);
  }

  function endLayoutInteraction() {
    dragRef.current = null;
  }

  if (collapsed) {
    return null;
  }

  return (
    <div
      className="camera-monitor"
      aria-label="当前机位监看"
      style={{ left: layout.x, top: layout.y, width: layout.width }}
      onPointerMove={updateLayoutFromPointer}
      onPointerUp={endLayoutInteraction}
      onPointerCancel={endLayoutInteraction}
    >
      <div className="camera-monitor-header" onMouseDown={beginMouseMove} onPointerDown={beginMove}>
        <span>机位监看</span>
        <strong>{activeCamera.name}</strong>
        <button
          className="camera-monitor-collapse"
          type="button"
          aria-label="收起机位监看"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            setCollapsed(true);
          }}
        >
          <Camera aria-hidden="true" size={14} strokeWidth={1.8} />
        </button>
      </div>
      <Canvas
        className="camera-monitor-canvas"
        camera={{ position: cameraView.position, fov: cameraView.fov }}
        dpr={MONITOR_CAPTURE_DPR}
        frameloop="always"
        gl={{ antialias: false, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          recorderCanvasRef.current = gl.domElement;
          registerCameraMonitorCanvas(gl.domElement);
        }}
        style={{ height }}
      >
        <ViewportBackground
          backgroundColor={sceneSettings.backgroundColor}
          panoramaAsset={panoramaAsset}
          panoramaRadius={sceneSettings.panoramaRadius}
          panoramaYaw={sceneSettings.panoramaYaw}
        />
        <StudioSceneLights />
        {sceneSettings.showGrid ? (
          <Grid
            cellThickness={0}
            fadeDistance={80}
            infiniteGrid
            position={[0, sceneSettings.groundHeight + MONITOR_GRID_ELEVATION, 0]}
            sectionColor="#2A4065"
          />
        ) : null}
        <CameraMonitorViewCamera view={cameraView} />
        <Suspense fallback={null}>
          <SceneRoot key={sceneContentKey} showCameraRigs={false} />
        </Suspense>
        <CameraMonitorRenderAndCapture />
      </Canvas>
      <span className="camera-monitor-fov">FOV {activeCamera.fov}</span>
      <button
        className="camera-monitor-resize"
        type="button"
        aria-label="缩放机位监看窗口"
        onMouseDown={beginMouseResize}
        onPointerDown={beginResize}
      />
    </div>
  );
}
