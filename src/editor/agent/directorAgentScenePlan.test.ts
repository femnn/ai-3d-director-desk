import { describe, expect, it } from "vitest";
import { validateScenePlan } from "./directorAgent";

describe("ScenePlan validation", () => {
  it("keeps a structured plan and reports duplicate roles", () => {
    const result = validateScenePlan({
      intent: "两人茶桌对话",
      composition: "正反打",
      roles: [{ name: "女主", relation: "面向男主" }, { name: "女主" }],
    });

    expect(result.plan.intent).toBe("两人茶桌对话");
    expect(result.warnings[0]).toContain("女主");
  });

  it("rejects a plan without an intent or roles", () => {
    expect(() => validateScenePlan({ roles: [] })).toThrow("ScenePlan 缺少 intent");
  });
});
