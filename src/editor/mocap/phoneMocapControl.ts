import { playNormalCharacterAnimations } from "../animation/characterAnimation";
import type { CharacterActionTrack, CharacterMotionFrame } from "../schema/directorProject";
import { useDirectorStore } from "../store/directorStore";

type PhoneMocapPhase = "start" | "frame" | "finish" | "cancel";

export interface PhoneMocapState {
  phoneClientId?: string;
  characterId?: string;
  phase?: PhoneMocapPhase;
  duration?: number;
  time?: number;
  controls?: Record<string, number>;
}

type PhoneMocapSession = {
  phoneClientId: string;
  characterId: string;
  duration: number;
  frames: CharacterMotionFrame[];
};

const sessionsByPhoneId = new Map<string, PhoneMocapSession>();
const phoneIdByCharacterId = new Map<string, string>();

function isValidControls(value: unknown): value is Record<string, number> {
  return Boolean(
    value &&
      typeof value === "object" &&
      Object.values(value).every((control) => typeof control === "number" && Number.isFinite(control))
  );
}

function saveSession(session: PhoneMocapSession) {
  const store = useDirectorStore.getState();
  const role = store.project.objects.find((object) => object.id === session.characterId && object.kind === "character");
  if (!role || session.frames.length < 2) return;

  const clipDuration = Math.max(session.frames[session.frames.length - 1].time, 0.1);
  const clipId = store.addCharacterMotionClip({
    characterId: role.id,
    name: `${role.name}-手机动捕`,
    duration: clipDuration,
    frames: session.frames,
  });
  const track: CharacterActionTrack = {
    actionId: "idle",
    duration: Math.max(session.duration, 5),
    loop: false,
    playbackMode: "normal",
    cameraId: null,
    enabled: true,
    source: "mocap",
    motionClipId: clipId,
  };
  store.setCharacterActionTrack(role.id, track);
  playNormalCharacterAnimations(
    useDirectorStore
      .getState()
      .project.objects.filter((object) => object.kind === "character" && object.characterActionTrack?.enabled && object.characterActionTrack.playbackMode === "normal")
      .map((object) => object.id)
  );
}

export function getPhoneMocapAssignments() {
  return Object.fromEntries(Array.from(sessionsByPhoneId.entries(), ([phoneId, session]) => [phoneId, session.characterId]));
}

export function releasePhoneMocap(phoneClientId: string) {
  const session = sessionsByPhoneId.get(phoneClientId);
  if (!session) return;
  sessionsByPhoneId.delete(phoneClientId);
  if (phoneIdByCharacterId.get(session.characterId) === phoneClientId) phoneIdByCharacterId.delete(session.characterId);
}

export function handlePhoneMocapState(payload: unknown) {
  const state = payload as PhoneMocapState;
  const phoneClientId = typeof state?.phoneClientId === "string" ? state.phoneClientId : "";
  const characterId = typeof state?.characterId === "string" ? state.characterId : "";
  if (!phoneClientId || !characterId) return;

  if (state.phase === "cancel") {
    releasePhoneMocap(phoneClientId);
    return;
  }

  if (state.phase === "start") {
    const role = useDirectorStore.getState().project.objects.find(
      (object) => object.id === characterId && object.kind === "character" && object.characterRig?.rigType === "ue4-mannequin" && !object.assetRefId
    );
    const owner = phoneIdByCharacterId.get(characterId);
    if (!role || (owner && owner !== phoneClientId)) return;
    releasePhoneMocap(phoneClientId);
    const duration = typeof state.duration === "number" && Number.isFinite(state.duration) ? Math.min(Math.max(state.duration, 5), 15) : 5;
    sessionsByPhoneId.set(phoneClientId, { phoneClientId, characterId, duration, frames: [] });
    phoneIdByCharacterId.set(characterId, phoneClientId);
    return;
  }

  const session = sessionsByPhoneId.get(phoneClientId);
  if (!session || session.characterId !== characterId) return;

  if (state.phase === "frame" && isValidControls(state.controls) && typeof state.time === "number" && Number.isFinite(state.time)) {
    const time = Math.min(Math.max(state.time, 0), session.duration);
    const previous = session.frames[session.frames.length - 1];
    if (!previous || time - previous.time >= 1 / 30) {
      session.frames.push({ time: Number(time.toFixed(3)), controls: { ...state.controls } });
    }
    return;
  }

  if (state.phase === "finish") {
    saveSession(session);
    releasePhoneMocap(phoneClientId);
  }
}
