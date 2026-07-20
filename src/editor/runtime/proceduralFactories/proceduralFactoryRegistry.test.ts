import { expect, it } from "vitest";
import {
  getCrimsonTransformerParameters,
  getTrainStationChaseParameters,
  normalizeProceduralFactorySettings,
} from "./proceduralFactoryRegistry";

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

it("normalizes the 15 second train chase timeline", () => {
  const settings = normalizeProceduralFactorySettings("train-station-car-chase", {
    time: 21,
    autoPlay: false,
    duration: 15,
  });
  expect(getTrainStationChaseParameters(settings)).toEqual({
    time: 15,
    autoPlay: false,
    duration: 15,
  });
});
