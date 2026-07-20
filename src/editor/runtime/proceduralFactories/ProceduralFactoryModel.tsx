import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import type { Object3D } from "three";
import type { DirectorProceduralFactorySettings } from "../../schema/directorProject";
import { createCrimsonTransformer } from "./crimsonTransformerFactory";
import { createTrainStationChase } from "./trainStationChaseFactory";
import { createAlienParkAbduction } from "./alienParkAbductionFactory";
import {
  getAlienParkAbductionParameters,
  getCrimsonTransformerParameters,
  getTrainStationChaseParameters,
} from "./proceduralFactoryRegistry";

function disposeObject(root: Object3D) {
  root.traverse((child) => {
    const mesh = child as Object3D & {
      geometry?: { dispose: () => void };
      material?: { dispose: () => void } | Array<{ dispose: () => void }>;
    };
    mesh.geometry?.dispose();
    if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
    else mesh.material?.dispose();
  });
}

function CrimsonTransformerModel({
  color,
  settings,
}: {
  color?: string;
  settings: DirectorProceduralFactorySettings;
}) {
  const runtime = useMemo(() => createCrimsonTransformer(color), [color]);
  const parameters = getCrimsonTransformerParameters(settings);

  useEffect(() => () => disposeObject(runtime.root), [runtime]);

  useFrame(() => {
    let morph = parameters.morph;
    if (parameters.autoTransform) {
      const phase = ((Date.now() / 1000) % parameters.transformDuration) / parameters.transformDuration;
      const triangle = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
      morph = triangle * triangle * (3 - 2 * triangle);
    }
    runtime.setMorph(morph);
  });

  return <primitive object={runtime.root} />;
}

function TrainStationChaseModel({ settings }: { settings: DirectorProceduralFactorySettings }) {
  const runtime = useMemo(() => createTrainStationChase(), []);
  const parameters = getTrainStationChaseParameters(settings);

  useEffect(() => () => disposeObject(runtime.root), [runtime]);

  useFrame(() => {
    const elapsed = parameters.autoPlay
      ? (Date.now() / 1000) % parameters.duration
      : (parameters.time / 15) * parameters.duration;
    runtime.setTime(elapsed, parameters.duration);
  });

  return <primitive object={runtime.root} />;
}

function AlienParkAbductionModel({ settings }: { settings: DirectorProceduralFactorySettings }) {
  const runtime = useMemo(() => createAlienParkAbduction(), []);
  const parameters = getAlienParkAbductionParameters(settings);

  useEffect(() => () => disposeObject(runtime.root), [runtime]);

  useFrame(() => {
    const elapsed = parameters.autoPlay
      ? (Date.now() / 1000) % parameters.duration
      : (parameters.time / 15) * parameters.duration;
    runtime.setTime(elapsed, parameters.duration);
  });

  return <primitive object={runtime.root} />;
}

export function ProceduralFactoryModel({
  color,
  settings,
}: {
  color?: string;
  settings: DirectorProceduralFactorySettings;
}) {
  if (settings.id === "crimson-transformer") {
    return <CrimsonTransformerModel color={color} settings={settings} />;
  }
  if (settings.id === "train-station-car-chase") {
    return <TrainStationChaseModel settings={settings} />;
  }
  if (settings.id === "alien-park-abduction") {
    return <AlienParkAbductionModel settings={settings} />;
  }
  return null;
}
