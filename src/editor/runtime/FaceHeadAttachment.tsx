import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { Component, Suspense, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { Box3, Group, Matrix4, Mesh, Quaternion, Vector3, type Object3D } from "three";
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

class FaceHeadBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function getInfluence(sample: CharacterFaceSample, ...names: string[]) {
  for (const name of names) {
    const value = sample.influences[name];
    if (typeof value === "number" && Number.isFinite(value)) return Math.min(1, Math.max(0, value));
  }
  return 0;
}

function FallbackFaceHead({ sample }: { sample: CharacterFaceSample }) {
  const jawOpen = getInfluence(sample, "jawOpen", "mouthOpen");
  const smile = Math.max(
    getInfluence(sample, "mouthSmileLeft", "mouthSmile_L", "smileLeft"),
    getInfluence(sample, "mouthSmileRight", "mouthSmile_R", "smileRight")
  );
  const leftBlink = getInfluence(sample, "eyeBlinkLeft", "eyeBlink_L", "blinkLeft");
  const rightBlink = getInfluence(sample, "eyeBlinkRight", "eyeBlink_R", "blinkRight");

  return (
    <group quaternion={sample.headRotation} name="face-capture-fallback-head">
      <mesh scale={[0.84, 1, 0.78]}>
        <sphereGeometry args={[0.17, 28, 24]} />
        <meshStandardMaterial color="#D8DDE5" metalness={0.02} roughness={0.82} />
      </mesh>
      <mesh position={[-0.052, 0.025, 0.132]} scale={[1, Math.max(0.08, 1 - leftBlink * 0.92), 0.45]}>
        <sphereGeometry args={[0.018, 12, 10]} />
        <meshStandardMaterial color="#151A22" roughness={0.9} />
      </mesh>
      <mesh position={[0.052, 0.025, 0.132]} scale={[1, Math.max(0.08, 1 - rightBlink * 0.92), 0.45]}>
        <sphereGeometry args={[0.018, 12, 10]} />
        <meshStandardMaterial color="#151A22" roughness={0.9} />
      </mesh>
      <mesh position={[0, -0.02, 0.145]} scale={[0.62, 0.88, 0.5]}>
        <sphereGeometry args={[0.024, 12, 10]} />
        <meshStandardMaterial color="#C4CAD3" roughness={0.86} />
      </mesh>
      <mesh
        position={[0, -0.078 + jawOpen * -0.008, 0.14]}
        scale={[1 + smile * 0.45, 0.22 + jawOpen * 1.25, 0.35]}
      >
        <sphereGeometry args={[0.045, 18, 12]} />
        <meshStandardMaterial color="#6C3540" roughness={0.8} />
      </mesh>
    </group>
  );
}

function RiggedFaceAnchor({
  children,
  mannequinScene,
  headBone,
}: {
  children: ReactNode;
  mannequinScene: Object3D;
  headBone: Object3D;
}) {
  const anchorRef = useRef<Group>(null!);
  const originalHeadScale = useMemo(() => headBone.scale.clone(), [headBone]);
  const restHeadQuaternion = useRef<Quaternion | null>(null);
  const inverse = useMemo(() => new Matrix4(), []);
  const localMatrix = useMemo(() => new Matrix4(), []);
  const position = useMemo(() => new Vector3(), []);
  const quaternion = useMemo(() => new Quaternion(), []);
  const ignoredScale = useMemo(() => new Vector3(), []);
  const inverseRestRotation = useMemo(() => new Quaternion(), []);

  useLayoutEffect(() => {
    headBone.scale.setScalar(0.001);
    mannequinScene.updateMatrixWorld(true);
    return () => {
      headBone.scale.copy(originalHeadScale);
      mannequinScene.updateMatrixWorld(true);
    };
  }, [headBone, mannequinScene, originalHeadScale]);

  useFrame(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    headBone.scale.setScalar(0.001);
    headBone.updateWorldMatrix(true, false);
    inverse.copy(mannequinScene.matrixWorld).invert();
    localMatrix.multiplyMatrices(inverse, headBone.matrixWorld).decompose(position, quaternion, ignoredScale);
    if (!restHeadQuaternion.current) restHeadQuaternion.current = quaternion.clone();
    inverseRestRotation.copy(restHeadQuaternion.current).invert();
    anchor.position.copy(position);
    anchor.quaternion.copy(quaternion).multiply(inverseRestRotation);
  });

  return (
    <group ref={anchorRef} name="face-capture-rigged-anchor">
      <mesh name="face-capture-rigged-neck" position={[0, -0.075, 0]}>
        <cylinderGeometry args={[0.066, 0.082, 0.31, 24]} />
        <meshStandardMaterial color="#D8DDE5" metalness={0.02} roughness={0.82} />
      </mesh>
      <mesh name="face-capture-rigged-collar" position={[0, -0.225, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.092, 0.018, 10, 32]} />
        <meshStandardMaterial color="#D9E2EE" metalness={0.02} roughness={0.78} />
      </mesh>
      <group position={[0, 0.105, 0]}>{children}</group>
    </group>
  );
}

function collectMorphMeshes(root: Object3D) {
  const meshes: Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof Mesh && object.morphTargetDictionary && object.morphTargetInfluences) meshes.push(object);
  });
  return meshes;
}

export function applyFaceSampleToMorphMeshes(
  trackingRoot: Group | null,
  meshes: Mesh[],
  sample: CharacterFaceSample
) {
  if (trackingRoot) {
    trackingRoot.quaternion.fromArray(sample.headRotation).normalize();
  }
  meshes.forEach((face) => {
    const dictionary = face.morphTargetDictionary;
    const influences = face.morphTargetInfluences;
    if (!dictionary || !influences) return;
    influences.fill(0);
    Object.entries(sample.influences).forEach(([name, value]) => {
      const index = dictionary[name];
      if (index !== undefined) influences[index] = value;
    });
  });
}

function LoadedFaceHead({ instanceId, profile, sample }: {
  instanceId: string;
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
  const trackingRef = useRef<Group>(null!);
  const sampleRef = useRef(sample);
  sampleRef.current = sample;
  const prepared = useMemo(() => {
    const scene = cloneSkeleton(gltf.scene) as Group;
    scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      // Morph weights belong to the mesh instance. Keep the original geometry
      // because cloning the GNM morph geometry corrupts its calibrated bounds.
      if (object.morphTargetInfluences) object.morphTargetInfluences = [...object.morphTargetInfluences];
      object.frustumCulled = false;
    });
    scene.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(scene, true);
    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    const desiredHeight = 0.3;
    const scale = desiredHeight / Math.max(0.001, size.y);
    scene.position.copy(center).multiplyScalar(-1);
    const container = new Group();
    container.name = `face-capture-avatar-head-${profile}-${instanceId}`;
    container.scale.setScalar(scale);
    container.add(scene);
    return { container, meshes: collectMorphMeshes(scene) };
  }, [gltf.scene, instanceId, profile]);
  useFrame(() => {
    applyFaceSampleToMorphMeshes(trackingRef.current, prepared.meshes, sampleRef.current);
  });

  return (
    <group ref={trackingRef} name="face-capture-tracking-root">
      <primitive object={prepared.container} />
    </group>
  );
}

export function FaceHeadAttachment({ headBone, instanceId = "face-actor", mannequinScene, profile, sample }: {
  headBone?: Object3D;
  instanceId?: string;
  mannequinScene?: Object3D;
  profile: CharacterFaceProfile;
  sample: CharacterFaceSample;
}) {
  const fallback = <FallbackFaceHead sample={sample} />;
  const content = (
    <FaceHeadBoundary key={profile} fallback={fallback}>
      <Suspense fallback={fallback}>
        <LoadedFaceHead instanceId={instanceId} profile={profile} sample={sample} />
      </Suspense>
    </FaceHeadBoundary>
  );
  return mannequinScene && headBone ? (
    <RiggedFaceAnchor mannequinScene={mannequinScene} headBone={headBone}>{content}</RiggedFaceAnchor>
  ) : content;
}
