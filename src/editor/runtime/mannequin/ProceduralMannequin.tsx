import type { CharacterFaceSample } from "../../animation/characterFaceAnimation";
import { NEUTRAL_CHARACTER_FACE_SAMPLE } from "../../animation/characterFaceAnimation";
import type { CharacterFaceProfile, CharacterRigState } from "../../schema/directorProject";
import { FaceHeadAttachment } from "../FaceHeadAttachment";
import { getBodyPreset, type CharacterBodyType } from "./bodyTypes";
import { degreesToRadians, getBodyTypePoseLimit, getRotationFromControls, getSingleAxisRotation } from "./mannequinPose";
import { Foot, Hand, Head, HumanoidMaterial, Joint, Segment, Torso } from "./mannequinParts";

interface ProceduralMannequinProps {
  bodyType?: CharacterBodyType;
  color?: string;
  faceProfile?: CharacterFaceProfile;
  faceSample?: CharacterFaceSample;
  instanceId?: string;
  rigState?: CharacterRigState;
}

function clampDegrees(value: number, bodyType?: CharacterBodyType) {
  const limit = getBodyTypePoseLimit(bodyType);
  return Math.min(limit, Math.max(-limit, value));
}

function getLimbRotation(
  controls: Record<string, number>,
  prefix: string,
  bodyType?: CharacterBodyType
): [number, number, number] {
  return [
    degreesToRadians(clampDegrees(controls[`${prefix}.pitch`] ?? 0, bodyType)),
    degreesToRadians(clampDegrees(controls[`${prefix}.twist`] ?? 0, bodyType)),
    degreesToRadians(clampDegrees(controls[`${prefix}.spread`] ?? 0, bodyType)),
  ];
}

export function ProceduralMannequin({
  bodyType,
  color = "#4F8EF7",
  faceProfile = "facecap52",
  faceSample = NEUTRAL_CHARACTER_FACE_SAMPLE,
  instanceId = "face-actor",
  rigState,
}: ProceduralMannequinProps) {
  const preset = getBodyPreset(bodyType);
  const controls = rigState?.controls ?? {};
  const p = preset.proportions;
  const isFaceCaptureActor = preset.bodyType === "face-capture";
  const upperBodyColor = color;
  const lowerBodyColor = isFaceCaptureActor ? "#253044" : color;
  const skinColor = isFaceCaptureActor ? "#D8DDE5" : color;
  const shoeColor = isFaceCaptureActor ? "#101722" : color;

  const bodyRotation = getRotationFromControls(controls, "body", preset.bodyType);
  const torsoRotation = getRotationFromControls(controls, "torso", preset.bodyType);
  const headRotation = getRotationFromControls(controls, "head", preset.bodyType);
  const leftShoulderRotation = getLimbRotation(controls, "leftShoulder", preset.bodyType);
  const rightShoulderRotation = getLimbRotation(controls, "rightShoulder", preset.bodyType);
  const leftElbowRotation = getSingleAxisRotation(controls, "leftElbow.bend", preset.bodyType);
  const rightElbowRotation = getSingleAxisRotation(controls, "rightElbow.bend", preset.bodyType);
  const leftHipRotation = getLimbRotation(controls, "leftHip", preset.bodyType);
  const rightHipRotation = getLimbRotation(controls, "rightHip", preset.bodyType);
  const leftKneeRotation = getSingleAxisRotation(controls, "leftKnee.bend", preset.bodyType);
  const rightKneeRotation = getSingleAxisRotation(controls, "rightKnee.bend", preset.bodyType);

  const abdomenY = p.hipY + p.pelvisRadius * 0.6 + p.torsoLowerHeight * 0.5;
  const chestY = abdomenY + p.torsoLowerHeight * 0.5 + p.torsoUpperHeight * 0.5 + p.torsoUpperRadius * 0.1;
  const neckY = chestY + p.torsoUpperHeight * 0.5 + p.neckHeight * 0.5 + p.torsoUpperRadius * 0.2;
  const headY = neckY + p.neckHeight * 0.5 + p.headRadius * 0.75;

  const shoulderY = chestY + p.torsoUpperHeight * 0.16 + p.shoulderRadius * 0.4;
  const armOriginY = shoulderY - p.shoulderRadius * 0.55;
  const elbowY = -(p.upperArmLength + p.upperArmRadius + p.elbowRadius);
  const wristY = -(p.forearmLength + p.forearmRadius + p.wristRadius);
  const handY = wristY - p.handRadius - 0.05;

  const hipJointY = p.hipY - p.pelvisRadius * 0.15;
  const legOriginY = p.hipY - p.pelvisRadius * 0.35;
  const kneeY = -(p.thighLength + p.thighRadius + p.kneeRadius);
  const ankleY = -(p.calfLength + p.calfRadius + p.ankleRadius);
  const footY = ankleY - p.footRadius - 0.045;
  const faceCaptureGroundOffset = isFaceCaptureActor
    ? -(legOriginY + kneeY + footY) + p.footRadius * p.footScale[1]
    : 0;
  const jointScale: [number, number, number] = [p.jointRadiusScale, p.jointRadiusScale, p.jointRadiusScale];

  return (
    <group
      name={`procedural-${preset.bodyType}`}
      position={[0, faceCaptureGroundOffset, 0]}
      rotation={bodyRotation}
      scale={preset.defaultScale}
    >
      <group rotation={torsoRotation}>
        <Torso
          abdomenPosition={[0, abdomenY, 0]}
          abdomenScale={p.torsoLowerScale}
          chestPosition={[0, chestY, 0]}
          chestScale={p.torsoUpperScale}
          color={upperBodyColor}
          pelvisPosition={[0, p.hipY, 0]}
          pelvisColor={isFaceCaptureActor ? lowerBodyColor : undefined}
          pelvisRadius={p.pelvisRadius}
          pelvisScale={p.pelvisScale}
          torsoLowerHeight={p.torsoLowerHeight}
          torsoLowerRadius={p.torsoLowerRadius}
          torsoUpperHeight={p.torsoUpperHeight}
          torsoUpperRadius={p.torsoUpperRadius}
        />
        {isFaceCaptureActor ? (
          <>
            <mesh name="face-capture-neck" position={[0, neckY, 0]}>
              <cylinderGeometry args={[p.neckRadius * 0.88, p.neckRadius, p.neckHeight, 24]} />
              <HumanoidMaterial color={skinColor} />
            </mesh>
            <mesh
              name="face-capture-collar"
              position={[0, neckY - p.neckHeight * 0.38, 0]}
              rotation={[Math.PI / 2, 0, 0]}
            >
              <torusGeometry args={[p.neckRadius * 1.36, 0.018, 10, 36]} />
              <HumanoidMaterial color="#D9E2EE" />
            </mesh>
            <mesh
              name="face-capture-shirt-hem"
              position={[0, p.hipY + p.pelvisRadius * 0.62, 0]}
              rotation={[Math.PI / 2, 0, 0]}
              scale={[1, p.torsoLowerScale[2] / p.torsoLowerScale[0], 1]}
            >
              <torusGeometry args={[p.torsoLowerRadius * p.torsoLowerScale[0] * 0.98, 0.018, 10, 36]} />
              <HumanoidMaterial color="#D9E2EE" />
            </mesh>
            <group name="face-capture-head" position={[0, headY, 0]} rotation={headRotation}>
              <FaceHeadAttachment instanceId={instanceId} profile={faceProfile} sample={faceSample} />
            </group>
          </>
        ) : (
          <Head
            color={color}
            eyeRadius={p.eyeRadius}
            faceOffsetZ={p.faceOffsetZ}
            headRadius={p.headRadius}
            headScale={p.headScale}
            mouthScale={p.mouthScale}
            neckHeight={p.neckHeight}
            neckPosition={[0, neckY, 0]}
            neckRadius={p.neckRadius}
            noseScale={p.noseScale}
            position={[0, headY, 0]}
            rotation={headRotation}
          />
        )}

        <Joint color={upperBodyColor} position={[-p.shoulderWidth * 0.86, shoulderY, 0]} radius={p.shoulderRadius} scale={jointScale} />
        <Joint color={upperBodyColor} position={[p.shoulderWidth * 0.86, shoulderY, 0]} radius={p.shoulderRadius} scale={jointScale} />

        <group position={[-p.shoulderWidth, armOriginY, 0]} rotation={leftShoulderRotation}>
          <Segment
            color={upperBodyColor}
            length={p.upperArmLength}
            position={[0, -(p.upperArmLength * 0.5 + p.upperArmRadius), 0]}
            radius={p.upperArmRadius}
          />
          <group position={[0, elbowY, 0]} rotation={leftElbowRotation}>
            <Joint color={upperBodyColor} position={[0, 0, 0]} radius={p.elbowRadius} scale={jointScale} />
            <Segment
              color={upperBodyColor}
              length={p.forearmLength}
              position={[0, -(p.forearmLength * 0.5 + p.forearmRadius), 0]}
              radius={p.forearmRadius}
            />
            <Joint color={upperBodyColor} position={[0, wristY, 0]} radius={p.wristRadius} scale={jointScale} />
            <Hand color={skinColor} position={[0, handY, 0.02]} radius={p.handRadius} scale={p.handScale} side="left" />
          </group>
        </group>

        <group position={[p.shoulderWidth, armOriginY, 0]} rotation={rightShoulderRotation}>
          <Segment
            color={upperBodyColor}
            length={p.upperArmLength}
            position={[0, -(p.upperArmLength * 0.5 + p.upperArmRadius), 0]}
            radius={p.upperArmRadius}
          />
          <group position={[0, elbowY, 0]} rotation={rightElbowRotation}>
            <Joint color={upperBodyColor} position={[0, 0, 0]} radius={p.elbowRadius} scale={jointScale} />
            <Segment
              color={upperBodyColor}
              length={p.forearmLength}
              position={[0, -(p.forearmLength * 0.5 + p.forearmRadius), 0]}
              radius={p.forearmRadius}
            />
            <Joint color={upperBodyColor} position={[0, wristY, 0]} radius={p.wristRadius} scale={jointScale} />
            <Hand color={skinColor} position={[0, handY, 0.02]} radius={p.handRadius} scale={p.handScale} side="right" />
          </group>
        </group>
      </group>

      <Joint color={lowerBodyColor} position={[-p.legSpread, hipJointY, 0]} radius={p.thighRadius * 1.08} scale={jointScale} />
      <Joint color={lowerBodyColor} position={[p.legSpread, hipJointY, 0]} radius={p.thighRadius * 1.08} scale={jointScale} />

      <group position={[-p.legSpread, legOriginY, 0]} rotation={leftHipRotation}>
        <Segment
          color={lowerBodyColor}
          length={p.thighLength}
          position={[0, -(p.thighLength * 0.5 + p.thighRadius), 0]}
          radius={p.thighRadius}
        />
        <group position={[0, kneeY, 0]} rotation={leftKneeRotation}>
          <Joint color={lowerBodyColor} position={[0, 0, 0]} radius={p.kneeRadius} scale={jointScale} />
          <Segment
            color={lowerBodyColor}
            length={p.calfLength}
            position={[0, -(p.calfLength * 0.5 + p.calfRadius), 0]}
            radius={p.calfRadius}
          />
          <Joint color={lowerBodyColor} position={[0, ankleY, 0]} radius={p.ankleRadius} scale={jointScale} />
          <Foot color={shoeColor} length={p.footLength} position={[0, footY, p.footRadius * 0.74]} radius={p.footRadius} scale={p.footScale} side="left" />
        </group>
      </group>

      <group position={[p.legSpread, legOriginY, 0]} rotation={rightHipRotation}>
        <Segment
          color={lowerBodyColor}
          length={p.thighLength}
          position={[0, -(p.thighLength * 0.5 + p.thighRadius), 0]}
          radius={p.thighRadius}
        />
        <group position={[0, kneeY, 0]} rotation={rightKneeRotation}>
          <Joint color={lowerBodyColor} position={[0, 0, 0]} radius={p.kneeRadius} scale={jointScale} />
          <Segment
            color={lowerBodyColor}
            length={p.calfLength}
            position={[0, -(p.calfLength * 0.5 + p.calfRadius), 0]}
            radius={p.calfRadius}
          />
          <Joint color={lowerBodyColor} position={[0, ankleY, 0]} radius={p.ankleRadius} scale={jointScale} />
          <Foot color={shoeColor} length={p.footLength} position={[0, footY, p.footRadius * 0.74]} radius={p.footRadius} scale={p.footScale} side="right" />
        </group>
      </group>
    </group>
  );
}
