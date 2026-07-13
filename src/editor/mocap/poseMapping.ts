export interface PoseLandmarkSample {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export type PoseCalibration = Record<string, number>;

const UPPER_BODY_POINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24];
const FULL_BODY_POINTS = [...UPPER_BODY_POINTS, 25, 26, 27, 28];
const MEDIA_POSE_POINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28] as const;

function clamp(value: number, min = -90, max = 90) {
  return Math.min(Math.max(value, min), max);
}

function degrees(value: number) {
  return (value * 180) / Math.PI;
}

function direction(from: PoseLandmarkSample, to: PoseLandmarkSample) {
  return { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
}

function length(vector: { x: number; y: number; z: number }) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function bend(first: PoseLandmarkSample, joint: PoseLandmarkSample, last: PoseLandmarkSample) {
  const a = direction(joint, first);
  const b = direction(joint, last);
  const denominator = Math.max(length(a) * length(b), 0.0001);
  const dot = clamp((a.x * b.x + a.y * b.y + a.z * b.z) / denominator, -1, 1);
  return clamp(180 - degrees(Math.acos(dot)), 0, 140);
}

function limbControls(
  root: PoseLandmarkSample,
  middle: PoseLandmarkSample,
  end: PoseLandmarkSample,
  side: "left" | "right",
  prefix: "Shoulder" | "Hip",
  bendKey: string
) {
  const vector = direction(root, middle);
  const controls: Record<string, number> = {};
  const downward = Math.max(vector.y, 0.0001);
  const imagePlaneLength = Math.max(Math.hypot(vector.x, vector.y), 0.0001);
  controls[`${side}${prefix}.pitch`] = clamp(degrees(Math.atan2(-vector.z, imagePlaneLength)));
  controls[`${side}${prefix}.spread`] = clamp(-degrees(Math.atan2(vector.x, downward)));
  controls[`${bendKey}`] = bend(root, middle, end);
  return controls;
}

export function hasUsableFullBodyPose(landmarks: PoseLandmarkSample[] | undefined) {
  return Boolean(
    landmarks &&
      FULL_BODY_POINTS.every((index) => {
        const landmark = landmarks[index];
        return landmark && (landmark.visibility ?? 1) >= 0.45;
      })
  );
}

export function hasUsableUpperBodyPose(landmarks: PoseLandmarkSample[] | undefined) {
  return Boolean(
    landmarks &&
      UPPER_BODY_POINTS.every((index) => {
        const landmark = landmarks[index];
        return landmark && (landmark.visibility ?? 1) >= 0.45;
      })
  );
}

export function mapPoseLandmarksToControls(landmarks: PoseLandmarkSample[]): Record<string, number> {
  if (!hasUsableUpperBodyPose(landmarks)) return {};
  const nose = landmarks[0];
  const leftShoulder = landmarks[11];
  const rightShoulder = landmarks[12];
  const leftHip = landmarks[23];
  const rightHip = landmarks[24];
  const shoulderCenter = {
    x: (leftShoulder.x + rightShoulder.x) / 2,
    y: (leftShoulder.y + rightShoulder.y) / 2,
    z: (leftShoulder.z + rightShoulder.z) / 2,
  };
  const hipCenter = {
    x: (leftHip.x + rightHip.x) / 2,
    y: (leftHip.y + rightHip.y) / 2,
    z: (leftHip.z + rightHip.z) / 2,
  };
  const torso = direction(hipCenter, shoulderCenter);
  const head = direction(shoulderCenter, nose);

  const controls: Record<string, number> = {
    "body.pitch": clamp(degrees(Math.atan2(-torso.z, Math.max(-torso.y, 0.0001))) * 0.55),
    "body.roll": clamp(-degrees(Math.atan2(torso.x, Math.max(-torso.y, 0.0001))) * 0.55),
    "torso.yaw": clamp(degrees(Math.atan2(leftShoulder.z - rightShoulder.z, leftShoulder.x - rightShoulder.x)) * 0.3),
    "head.pitch": clamp(degrees(Math.atan2(-head.z, Math.max(-head.y, 0.0001))) * 0.7),
    "head.yaw": clamp(degrees(Math.atan2(head.x, Math.max(-head.y, 0.0001))) * -0.7),
    ...limbControls(leftShoulder, landmarks[13], landmarks[15], "left", "Shoulder", "leftElbow.bend"),
    ...limbControls(rightShoulder, landmarks[14], landmarks[16], "right", "Shoulder", "rightElbow.bend"),
    ...(hasUsableFullBodyPose(landmarks)
      ? {
          ...limbControls(leftHip, landmarks[25], landmarks[27], "left", "Hip", "leftKnee.bend"),
          ...limbControls(rightHip, landmarks[26], landmarks[28], "right", "Hip", "rightKnee.bend"),
        }
      : {}),
  };

  MEDIA_POSE_POINTS.forEach((index) => {
    const landmark = landmarks[index];
    if (!landmark || (landmark.visibility ?? 1) < 0.35) return;
    // MediaPipe world coordinates use image-right and image-down. The UE4
    // mannequin faces local +Z with anatomical left on local -X.
    controls[`mediaPose.${index}.x`] = Number((-landmark.x).toFixed(5));
    controls[`mediaPose.${index}.y`] = Number((-landmark.y).toFixed(5));
    controls[`mediaPose.${index}.z`] = Number((-landmark.z).toFixed(5));
  });

  return controls;
}

export function applyPoseCalibration(controls: Record<string, number>, calibration: PoseCalibration | null) {
  if (!calibration) return controls;
  return Object.fromEntries(
    Object.entries(controls).map(([key, value]) => [key, Number(clamp(value - (calibration[key] ?? 0)).toFixed(3))])
  );
}
