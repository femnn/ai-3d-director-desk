import { Component, type ReactNode } from "react";
import type { CharacterRigState } from "../schema/directorProject";
import type { CharacterFaceSample } from "../animation/characterFaceAnimation";
import type { CharacterFaceProfile } from "../schema/directorProject";
import { PrimitiveMannequin } from "./PrimitiveMannequin";
import { UE4MannequinModel } from "./UE4MannequinModel";
import type { CharacterBodyType } from "./mannequin/bodyTypes";

interface CharacterModelProps {
  bodyType?: CharacterBodyType;
  color?: string;
  onLabelAnchorYChange?: (anchorY: number) => void;
  onJointPositionsChange?: (positions: Record<string, [number, number, number]>) => void;
  rigState?: CharacterRigState;
  faceProfile?: CharacterFaceProfile;
  faceSample?: CharacterFaceSample;
}

class CharacterModelBoundary extends Component<
  {
    fallback: ReactNode;
    children: ReactNode;
  },
  {
    hasError: boolean;
  }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

export function CharacterModel({ bodyType, color, faceProfile, faceSample, onJointPositionsChange, onLabelAnchorYChange, rigState }: CharacterModelProps) {
  const fallback = <PrimitiveMannequin bodyType={bodyType} color={color} rigState={rigState} />;

  if (rigState?.rigType !== "ue4-mannequin") {
    return fallback;
  }

  return (
    <CharacterModelBoundary fallback={fallback}>
      <UE4MannequinModel
        bodyType={bodyType}
        color={color}
        onJointPositionsChange={onJointPositionsChange}
        onLabelAnchorYChange={onLabelAnchorYChange}
        rigState={rigState}
        faceProfile={faceProfile}
        faceSample={faceSample}
      />
    </CharacterModelBoundary>
  );
}
