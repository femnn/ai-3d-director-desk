import type { CharacterFaceSample } from "../animation/characterFaceAnimation";
import type { CharacterFaceProfile, CharacterRigState } from "../schema/directorProject";
import { ProceduralMannequin } from "./mannequin/ProceduralMannequin";
import type { CharacterBodyType } from "./mannequin/bodyTypes";

interface PrimitiveMannequinProps {
  bodyType?: CharacterBodyType;
  color?: string;
  faceProfile?: CharacterFaceProfile;
  faceSample?: CharacterFaceSample;
  instanceId?: string;
  rigState?: CharacterRigState;
}

export function PrimitiveMannequin({ bodyType, color = "#4F8EF7", faceProfile, faceSample, instanceId, rigState }: PrimitiveMannequinProps) {
  return (
    <ProceduralMannequin
      bodyType={bodyType}
      color={color}
      faceProfile={faceProfile}
      faceSample={faceSample}
      instanceId={instanceId}
      rigState={rigState}
    />
  );
}
