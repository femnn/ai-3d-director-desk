import { Grid } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useRef, type RefObject } from "react";
import { Vector3 } from "three";
import type { CameraViewSnapshot } from "../editor/schema/cameraGeometry";
import { useDirectorStore } from "../editor/store/directorStore";
import { SceneRoot } from "../editor/canvas/SceneRoot";
import { StudioSceneLights } from "../editor/canvas/StudioSceneLights";
import { ViewportBackground } from "../editor/canvas/ViewportBackground";

export type PhoneCameraPreviewOption = {
  id: string;
  name: string;
  disabled?: boolean;
};

function PhonePreviewCamera({ viewRef }: { viewRef: RefObject<CameraViewSnapshot | null> }) {
  const camera = useThree((state) => state.camera);
  const positionRef = useRef(new Vector3());
  const targetRef = useRef(new Vector3());
  const desiredPositionRef = useRef(new Vector3());
  const desiredTargetRef = useRef(new Vector3());
  const initializedRef = useRef(false);
  const fovRef = useRef(35);

  useFrame((_, delta) => {
    const view = viewRef.current;
    if (!view) return;
    desiredPositionRef.current.set(...view.position);
    desiredTargetRef.current.set(...view.target);
    if (!initializedRef.current) {
      positionRef.current.copy(desiredPositionRef.current);
      targetRef.current.copy(desiredTargetRef.current);
      fovRef.current = view.fov;
      initializedRef.current = true;
    } else {
      const smoothing = 1 - Math.exp(-24 * Math.min(delta, 0.1));
      positionRef.current.lerp(desiredPositionRef.current, smoothing);
      targetRef.current.lerp(desiredTargetRef.current, smoothing);
      fovRef.current += (view.fov - fovRef.current) * smoothing;
    }
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

export function PhoneCameraPreview({
  cameraId,
  cameraOptions,
  ready,
  viewRef,
  displayFov,
  onCameraChange,
}: {
  cameraId: string;
  cameraOptions: PhoneCameraPreviewOption[];
  ready: boolean;
  viewRef: RefObject<CameraViewSnapshot | null>;
  displayFov: number;
  onCameraChange: (cameraId: string) => void;
}) {
  const scene = useDirectorStore((state) => state.project.scene);
  const assets = useDirectorStore((state) => state.project.assets);
  const panoramaAssetId = useDirectorStore((state) => state.project.panoramaAssetId);
  const panoramaAsset = assets.find((asset) => asset.id === panoramaAssetId);

  return (
    <section className="phone-camera-preview" aria-label="我的机位画面">
      <label className="phone-camera-preview-header">
        <span>我的镜头</span>
        <select aria-label="切换控制机位" value={cameraId} onChange={(event) => onCameraChange(event.currentTarget.value)}>
          <option value="">自动分配机位</option>
          {cameraOptions.map((camera) => (
            <option key={camera.id} value={camera.id} disabled={camera.disabled}>
              {camera.name}{camera.disabled ? "（其他手机控制中）" : ""}
            </option>
          ))}
        </select>
        {viewRef.current ? <strong>FOV {Math.round(displayFov)}</strong> : null}
      </label>
      {ready && viewRef.current ? (
        <Canvas
          key={cameraId}
          className="phone-camera-preview-canvas"
          camera={{ position: [0, 1.6, 5], fov: 35 }}
          frameloop="always"
          gl={{ antialias: false, powerPreference: "high-performance" }}
        >
          <ViewportBackground
            backgroundColor={scene.backgroundColor}
            panoramaAsset={panoramaAsset}
            panoramaRadius={scene.panoramaRadius}
            panoramaYaw={scene.panoramaYaw}
          />
          <StudioSceneLights />
          {scene.showGrid ? (
            <Grid
              cellThickness={0}
              fadeDistance={80}
              infiniteGrid
              position={[0, scene.groundHeight + 0.002, 0]}
              sectionColor="#2A4065"
            />
          ) : null}
          <PhonePreviewCamera viewRef={viewRef} />
          <SceneRoot showCameraRigs={false} />
        </Canvas>
      ) : (
        <div className="phone-camera-preview-empty">正在分配我的机位...</div>
      )}
    </section>
  );
}
