import { useDirectorStore } from "../store/directorStore";

const POSE_KEY_PATTERN = /^(body|torso|head|leftShoulder|rightShoulder|leftHand|rightHand|leftHip|rightHip|leftFoot|rightFoot)\.(pitch|yaw|roll|spread|twist)$|^(leftElbow|rightElbow|leftKnee|rightKnee)\.bend$/;
const phoneIdByCharacterId = new Map<string, string>();
const characterIdByPhoneId = new Map<string, string>();

export function releasePhonePose(phoneClientId: string) {
  const characterId = characterIdByPhoneId.get(phoneClientId);
  if (!characterId) return;
  characterIdByPhoneId.delete(phoneClientId);
  if (phoneIdByCharacterId.get(characterId) === phoneClientId) phoneIdByCharacterId.delete(characterId);
}

export function handlePhonePoseState(payload: unknown) {
  const value = payload as { phoneClientId?: string; characterId?: string; key?: string; value?: number; controls?: Record<string, number> };
  const controls =
    value?.controls && typeof value.controls === "object"
      ? Object.fromEntries(
          Object.entries(value.controls).filter(
            ([key, control]) => POSE_KEY_PATTERN.test(key) && typeof control === "number" && Number.isFinite(control)
          )
        )
      : typeof value?.key === "string" && POSE_KEY_PATTERN.test(value.key) && typeof value.value === "number" && Number.isFinite(value.value)
        ? { [value.key]: value.value }
        : {};
  if (
    typeof value?.phoneClientId !== "string" ||
    typeof value.characterId !== "string" ||
    !Object.keys(controls).length
  ) {
    return;
  }
  const owner = phoneIdByCharacterId.get(value.characterId);
  if (owner && owner !== value.phoneClientId) return;
  const role = useDirectorStore.getState().project.objects.find(
    (object) => object.id === value.characterId && object.kind === "character" && object.characterRig?.rigType === "ue4-mannequin" && !object.assetRefId
  );
  if (!role) return;
  releasePhonePose(value.phoneClientId);
  phoneIdByCharacterId.set(value.characterId, value.phoneClientId);
  characterIdByPhoneId.set(value.phoneClientId, value.characterId);
  useDirectorStore
    .getState()
    .updatePoseControls(
      value.characterId,
      Object.fromEntries(Object.entries(controls).map(([key, control]) => [key, Math.min(Math.max(control, -150), 150)]))
    );
}
