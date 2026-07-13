import { Euler, Quaternion, Vector3, type Object3D } from "three";
import type { CharacterBodyType } from "../mannequin/bodyTypes";
import {
  getUE4BodyBoneScales,
  getUE4NeutralPoseBoneRotations,
  getUE4PoseBonePositionOffsets,
  getUE4PoseBoneRotations,
} from "./ue4MannequinRig";

export interface UE4RestBoneTransform {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: [number, number, number];
}

export type UE4RestPose = Record<string, UE4RestBoneTransform>;

interface ApplyUE4RestPoseAndRigOptions {
  bodyType?: CharacterBodyType;
  controls: Record<string, number>;
  restPose: UE4RestPose;
}

function isBone(object: Object3D): object is Object3D & { isBone: true } {
  return "isBone" in object && object.isBone === true;
}

function applyRotationOffset(object: Object3D, rotation: [number, number, number]) {
  object.quaternion.multiply(new Quaternion().setFromEuler(new Euler(rotation[0], rotation[1], rotation[2])));
}

function readMediaPosePoint(controls: Record<string, number>, index: number) {
  const x = controls[`mediaPose.${index}.x`];
  const y = controls[`mediaPose.${index}.y`];
  const z = controls[`mediaPose.${index}.z`];
  if (![x, y, z].every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  return new Vector3(x, y, z);
}

function applyMediaPoseDirections(scene: Object3D, controls: Record<string, number>) {
  const chains = [
    ["Bip001_L_UpperArm_08", "Bip001_L_Forearm_09", 11, 13],
    ["Bip001_L_Forearm_09", "Bip001_L_Hand_010", 13, 15],
    ["Bip001_R_UpperArm_032", "Bip001_R_Forearm_033", 12, 14],
    ["Bip001_R_Forearm_033", "Bip001_R_Hand_034", 14, 16],
    ["Bip001_L_Thigh_057", "Bip001_L_Calf_058", 23, 25],
    ["Bip001_L_Calf_058", "Bip001_L_Foot_059", 25, 27],
    ["Bip001_R_Thigh_061", "Bip001_R_Calf_062", 24, 26],
    ["Bip001_R_Calf_062", "Bip001_R_Foot_063", 26, 28],
  ] as const;
  if (!readMediaPosePoint(controls, 11) || !readMediaPosePoint(controls, 12)) return;

  const sceneWorldRotation = scene.getWorldQuaternion(new Quaternion());
  const parentWorldInverse = new Quaternion();
  const desiredDirection = new Vector3();
  const authoredChildDirection = new Vector3();

  chains.forEach(([boneName, childName, fromIndex, toIndex]) => {
    const from = readMediaPosePoint(controls, fromIndex);
    const to = readMediaPosePoint(controls, toIndex);
    const bone = scene.getObjectByName(boneName);
    const child = scene.getObjectByName(childName);
    if (!from || !to || !bone?.parent || !child || child.parent !== bone) return;

    desiredDirection.copy(to).sub(from);
    if (desiredDirection.lengthSq() < 0.000001 || child.position.lengthSq() < 0.000001) return;
    desiredDirection.normalize().applyQuaternion(sceneWorldRotation);
    bone.parent.getWorldQuaternion(parentWorldInverse).invert();
    desiredDirection.applyQuaternion(parentWorldInverse).normalize();
    authoredChildDirection.copy(child.position).normalize();
    bone.quaternion.setFromUnitVectors(authoredChildDirection, desiredDirection);
    scene.updateMatrixWorld(true);
  });
}

export function captureUE4RestPose(scene: Object3D): UE4RestPose {
  const restPose: UE4RestPose = {};

  scene.traverse((object) => {
    if (!isBone(object)) return;

    restPose[object.name] = {
      position: [object.position.x, object.position.y, object.position.z],
      quaternion: [object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w],
      scale: [object.scale.x, object.scale.y, object.scale.z],
    };
  });

  return restPose;
}

export function applyUE4RestPoseAndRig(
  scene: Object3D,
  { bodyType = "mannequin", controls, restPose }: ApplyUE4RestPoseAndRigOptions
) {
  const bodyScales = getUE4BodyBoneScales(bodyType);
  const positionOffsets = getUE4PoseBonePositionOffsets(controls);
  const neutralRotations = getUE4NeutralPoseBoneRotations();
  const poseRotations = getUE4PoseBoneRotations(controls, bodyType);

  scene.traverse((object) => {
    if (!isBone(object)) return;

    const rest = restPose[object.name];
    if (!rest) return;

    object.position.set(rest.position[0], rest.position[1], rest.position[2]);
    object.quaternion.set(rest.quaternion[0], rest.quaternion[1], rest.quaternion[2], rest.quaternion[3]);
    object.scale.set(rest.scale[0], rest.scale[1], rest.scale[2]);

    const positionOffset = positionOffsets[object.name];
    if (positionOffset) {
      object.position.set(
        rest.position[0] + positionOffset[0],
        rest.position[1] + positionOffset[1],
        rest.position[2] + positionOffset[2]
      );
    }

    const scale = bodyScales[object.name];
    if (scale) {
      object.scale.set(rest.scale[0] * scale[0], rest.scale[1] * scale[1], rest.scale[2] * scale[2]);
    }

    const neutralRotation = neutralRotations[object.name];
    if (neutralRotation) {
      applyRotationOffset(object, neutralRotation);
    }

    const rotation = poseRotations[object.name];
    if (rotation) {
      applyRotationOffset(object, rotation);
    }
  });

  scene.updateMatrixWorld(true);
  applyMediaPoseDirections(scene, controls);
}
