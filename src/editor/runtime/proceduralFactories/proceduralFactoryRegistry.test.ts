import { expect, it } from "vitest";
import { getCrimsonTransformerParameters, normalizeProceduralFactorySettings } from "./proceduralFactoryRegistry";

it("normalizes the allowlisted transformer parameters", () => {
  const settings = normalizeProceduralFactorySettings("crimson-transformer", {
    morph: 4,
    autoTransform: true,
    transformDuration: 15,
  });

  expect(getCrimsonTransformerParameters(settings)).toEqual({
    morph: 1,
    autoTransform: true,
    transformDuration: 15,
  });
});

it("rejects executable or unknown factory identifiers", () => {
  expect(() => normalizeProceduralFactorySettings("eval-user-code", {})).toThrow("不支持的程序化工厂");
});
