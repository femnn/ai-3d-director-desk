import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import type { Object3D } from "three";
import type { DirectorProceduralFactorySettings } from "../../schema/directorProject";
import { createCrimsonTransformer } from "./crimsonTransformerFactory";
import { getCrimsonTransformerParameters } from "./proceduralFactoryRegistry";

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
  return null;
}
