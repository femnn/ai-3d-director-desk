import { Grid } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, type RefObject } from "react";
import type { CameraViewSnapshot } from "../editor/schema/cameraGeometry";
import { useDirectorStore } from "../editor/store/directorStore";
import { SceneRoot } from "../editor/canvas/SceneRoot";
import { ViewportBackground } from "../editor/canvas/ViewportBackground";

export type PhoneCameraPreviewOption = {
  id: string;
  name: string;
  disabled?: boolean;
};

function PhonePreviewCamera({ viewRef }: { viewRef: RefObject<CameraViewSnapshot | null> }) {
  const camera = useThree((state) => state.camera);

  useFrame(() => {
    const view = viewRef.current;
    if (!view) return;
    camera.position.set(...view.position);
    if ("fov" in camera) {
      camera.fov = view.fov;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(...view.target);
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
        <Canvas className="phone-camera-preview-canvas" camera={{ position: [0, 1.6, 5], fov: 35 }} gl={{ antialias: true }}>
          <ViewportBackground
            backgroundColor={scene.backgroundColor}
            panoramaAsset={panoramaAsset}
            panoramaRadius={scene.panoramaRadius}
            panoramaYaw={scene.panoramaYaw}
          />
          <ambientLight intensity={1.15} />
          <directionalLight intensity={1.2} position={[8, 10, 6]} />
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
          <Suspense fallback={null}>
            <SceneRoot showCameraRigs={false} />
          </Suspense>
        </Canvas>
      ) : (
        <div className="phone-camera-preview-empty">正在分配我的机位...</div>
      )}
    </section>
  );
}
