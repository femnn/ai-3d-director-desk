import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { Component, Suspense, useMemo, useRef, type ReactNode } from "react";
import { Box3, Group, Mesh, Quaternion, Vector3, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { CharacterFaceSample } from "../animation/characterFaceAnimation";
import type { CharacterFaceProfile } from "../schema/directorProject";
import { resolveDirectorAssetUrl } from "./ue4Mannequin/ue4MannequinRig";

const FACECAP_URL = resolveDirectorAssetUrl(import.meta.env.BASE_URL, "face-capture/facecap.glb");
const GNM_URL = resolveDirectorAssetUrl(import.meta.env.BASE_URL, "face-capture/gnm_head_runtime.glb");
const BASIS_URL = resolveDirectorAssetUrl(import.meta.env.BASE_URL, "face-capture/basis/");

interface LoadedGLTF {
  scene: Group;
}

class FaceHeadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function collectMorphMeshes(root: Object3D) {
  const meshes: Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof Mesh && object.morphTargetDictionary && object.morphTargetInfluences) meshes.push(object);
  });
  return meshes;
}

function LoadedFaceHead({ profile, sample }: { profile: CharacterFaceProfile; sample: CharacterFaceSample }) {
  const renderer = useThree((state) => state.gl);
  const url = profile === "facecap52" ? FACECAP_URL : GNM_URL;
  const gltf = useLoader(GLTFLoader, url, (loader) => {
    if (profile !== "facecap52") return;
    const ktx2 = new KTX2Loader().setTranscoderPath(BASIS_URL).detectSupport(renderer);
    loader.setKTX2Loader(ktx2);
    loader.setMeshoptDecoder(MeshoptDecoder);
  }) as LoadedGLTF;
  const trackingRef = useRef<Group>(null!);
  const prepared = useMemo(() => {
    const scene = cloneSkeleton(gltf.scene) as Group;
    scene.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(scene, true);
    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    const desiredHeight = profile === "facecap52" ? 0.34 : 0.33;
    const scale = desiredHeight / Math.max(0.001, size.y);
    scene.position.copy(center).multiplyScalar(-1);
    const container = new Group();
    container.name = `face-capture-avatar-head-${profile}`;
    container.scale.setScalar(scale);
    container.add(scene);
    return { container, meshes: collectMorphMeshes(scene) };
  }, [gltf.scene, profile]);
  const trackedRotation = useMemo(() => new Quaternion(), []);

  useFrame(() => {
    trackedRotation.fromArray(sample.headRotation).normalize();
    trackingRef.current?.quaternion.copy(trackedRotation);
    prepared.meshes.forEach((face) => {
      const dictionary = face.morphTargetDictionary;
      const influences = face.morphTargetInfluences;
      if (!dictionary || !influences) return;
      influences.fill(0);
      Object.entries(sample.influences).forEach(([name, value]) => {
        const index = dictionary[name];
        if (index !== undefined) influences[index] = value;
      });
    });
  });

  return (
    <group ref={trackingRef} name="face-capture-tracking-root">
      <primitive object={prepared.container} />
    </group>
  );
}

export function FaceHeadAttachment({ profile, sample }: {
  profile: CharacterFaceProfile;
  sample: CharacterFaceSample;
}) {
  return (
    <FaceHeadBoundary>
      <Suspense fallback={null}>
        <LoadedFaceHead profile={profile} sample={sample} />
      </Suspense>
    </FaceHeadBoundary>
  );
}
