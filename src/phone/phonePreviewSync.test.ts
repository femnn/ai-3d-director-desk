import { expect, it } from "vitest";
import { shouldApplyPhonePreview } from "./phonePreviewSync";

it("accepts a new desktop preview session even when its numeric revision restarted", () => {
  expect(
    shouldApplyPhonePreview(
      { token: "old-desktop:8", revision: 8 },
      "new-desktop:1",
      1
    )
  ).toBe(true);
});

it("ignores a repeated preview token and keeps compatibility with old revision-only messages", () => {
  expect(shouldApplyPhonePreview({ token: "desktop:3", revision: 3 }, "desktop:3", 3)).toBe(false);
  expect(shouldApplyPhonePreview({ token: "", revision: 2 }, undefined, 3)).toBe(true);
  expect(shouldApplyPhonePreview({ token: "", revision: 3 }, undefined, 2)).toBe(false);
});

