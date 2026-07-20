import {
  PROCEDURAL_FACTORY_OPTIONS,
  type DirectorProceduralFactorySettings,
  type ProceduralFactoryId,
} from "../../schema/directorProject";

const PROCEDURAL_FACTORY_IDS = new Set<string>(PROCEDURAL_FACTORY_OPTIONS.map((option) => option.id));

export type CrimsonTransformerParameters = {
  morph: number;
  autoTransform: boolean;
  transformDuration: 5 | 10 | 15;
};

export function isProceduralFactoryId(value: unknown): value is ProceduralFactoryId {
  return typeof value === "string" && PROCEDURAL_FACTORY_IDS.has(value);
}

function toDuration(value: unknown): 5 | 10 | 15 {
  return value === 5 || value === 15 ? value : 10;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeProceduralFactorySettings(
  id: unknown,
  parameters?: Record<string, unknown> | null
): DirectorProceduralFactorySettings {
  if (!isProceduralFactoryId(id)) throw new Error(`不支持的程序化工厂：${String(id ?? "")}`);

  if (id === "crimson-transformer") {
    const morphValue = typeof parameters?.morph === "number" && Number.isFinite(parameters.morph)
      ? parameters.morph
      : 0;
    return {
      id,
      parameters: {
        morph: clamp(morphValue, 0, 1),
        autoTransform: parameters?.autoTransform === true,
        transformDuration: toDuration(parameters?.transformDuration),
      },
    };
  }

  return { id };
}

export function getCrimsonTransformerParameters(
  settings: DirectorProceduralFactorySettings
): CrimsonTransformerParameters {
  const normalized = normalizeProceduralFactorySettings(settings.id, settings.parameters);
  return normalized.parameters as CrimsonTransformerParameters;
}
