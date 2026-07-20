import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  Box3,
  Group,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type Object3D,
} from "three";
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

function LoadedFaceHead({
  mannequinScene,
  headBone,
  profile,
  sample,
}: {
  mannequinScene: Object3D;
  headBone: Object3D;
  profile: CharacterFaceProfile;
  sample: CharacterFaceSample;
}) {
  const renderer = useThree((state) => state.gl);
  const url = profile === "facecap52" ? FACECAP_URL : GNM_URL;
  const gltf = useLoader(GLTFLoader, url, (loader) => {
    if (profile !== "facecap52") return;
    const ktx2 = new KTX2Loader().setTranscoderPath(BASIS_URL).detectSupport(renderer);
    loader.setKTX2Loader(ktx2);
    loader.setMeshoptDecoder(MeshoptDecoder);
  }) as LoadedGLTF;
  const anchorRef = useRef<Group>(null!);
  const originalHeadScale = useMemo(() => headBone.scale.clone(), [headBone]);
  const restHeadQuaternion = useRef<Quaternion | null>(null);
  const prepared = useMemo(() => {
    const scene = cloneSkeleton(gltf.scene) as Group;
    scene.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(scene, true);
    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    const desiredHeight = profile === "facecap52" ? 0.32 : 0.31;
    const scale = desiredHeight / Math.max(0.001, size.y);
    scene.position.copy(center).multiplyScalar(-1);
    const container = new Group();
    container.name = `character-face-${profile}`;
    container.scale.setScalar(scale);
    container.add(scene);
    return { container, meshes: collectMorphMeshes(scene) };
  }, [gltf.scene, profile]);
  const inverse = useMemo(() => new Matrix4(), []);
  const localMatrix = useMemo(() => new Matrix4(), []);
  const position = useMemo(() => new Vector3(), []);
  const quaternion = useMemo(() => new Quaternion(), []);
  const ignoredScale = useMemo(() => new Vector3(), []);
  const trackedRotation = useMemo(() => new Quaternion(), []);
  const inverseRestRotation = useMemo(() => new Quaternion(), []);

  useEffect(() => () => {
    headBone.scale.copy(originalHeadScale);
    mannequinScene.updateMatrixWorld(true);
  }, [headBone, mannequinScene, originalHeadScale]);

  useFrame(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    headBone.scale.copy(originalHeadScale);
    mannequinScene.updateMatrixWorld(true);
    inverse.copy(mannequinScene.matrixWorld).invert();
    localMatrix.multiplyMatrices(inverse, headBone.matrixWorld).decompose(position, quaternion, ignoredScale);
    if (!restHeadQuaternion.current) restHeadQuaternion.current = quaternion.clone();
    inverseRestRotation.copy(restHeadQuaternion.current).invert();
    trackedRotation.fromArray(sample.headRotation);
    anchor.position.copy(position);
    // UE4's head bone uses a model-specific local axis. Apply only its change
    // from the first rendered pose so a regular Y-up face remains upright.
    anchor.quaternion.copy(quaternion).multiply(inverseRestRotation).multiply(trackedRotation);

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

    // The original mannequin has no facial morphs. Collapse only its head bone
    // after reading the transform, while the replacement head remains a sibling.
    headBone.scale.setScalar(0.001);
    mannequinScene.updateMatrixWorld(true);
  });

  return (
    <group ref={anchorRef} name="character-face-anchor">
      <primitive object={prepared.container} />
    </group>
  );
}

export function FaceHeadAttachment(props: {
  mannequinScene: Object3D;
  headBone: Object3D;
  profile: CharacterFaceProfile;
  sample: CharacterFaceSample;
}) {
  return (
    <FaceHeadBoundary>
      <Suspense fallback={null}>
        <LoadedFaceHead {...props} />
      </Suspense>
    </FaceHeadBoundary>
  );
}
