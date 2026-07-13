export interface PhoneMotionAngles {
  yaw: number;
  pitch: number;
  roll: number;
}

export interface PhoneMotionSample {
  alpha: number;
  beta: number;
  gamma: number;
}

const DEGREE_TO_RADIAN = Math.PI / 180;

export function clampMotionValue(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function normalizeMotionDegrees(value: number) {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

export function getMotionCameraTarget(
  sample: PhoneMotionSample,
  baseSample: PhoneMotionSample,
  baseCamera: PhoneMotionAngles
): PhoneMotionAngles {
  const yawDelta = normalizeMotionDegrees(sample.alpha - baseSample.alpha);
  const pitchDelta = sample.beta - baseSample.beta;
  const rollDelta = sample.gamma - baseSample.gamma;

  return {
    // DeviceOrientation uses the inverse sign of the desktop R3F camera yaw.
    yaw: baseCamera.yaw - yawDelta * DEGREE_TO_RADIAN,
    pitch: clampMotionValue(baseCamera.pitch + (pitchDelta * Math.PI) / 260, -1.1, 1.1),
    roll: clampMotionValue(baseCamera.roll - (rollDelta * Math.PI) / 360, -0.5, 0.5),
  };
}

export function smoothMotionCameraAngles(
  current: PhoneMotionAngles,
  target: PhoneMotionAngles,
  elapsedMs: number
): PhoneMotionAngles {
  const smoothing = 1 - Math.exp(-Math.min(Math.max(elapsedMs, 0), 64) / 170);
  const yawDifference = normalizeMotionDegrees((target.yaw - current.yaw) / DEGREE_TO_RADIAN);
  const pitchDifference = (target.pitch - current.pitch) / DEGREE_TO_RADIAN;
  const rollDifference = (target.roll - current.roll) / DEGREE_TO_RADIAN;

  if (Math.abs(yawDifference) < 0.32 && Math.abs(pitchDifference) < 0.24 && Math.abs(rollDifference) < 0.36) {
    return current;
  }

  return {
    yaw: current.yaw + yawDifference * DEGREE_TO_RADIAN * smoothing,
    pitch: clampMotionValue(current.pitch + pitchDifference * DEGREE_TO_RADIAN * smoothing, -1.1, 1.1),
    roll: clampMotionValue(current.roll + rollDifference * DEGREE_TO_RADIAN * smoothing, -0.5, 0.5),
  };
}
