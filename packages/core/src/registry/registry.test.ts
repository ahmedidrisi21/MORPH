import { describe, expect, it } from "vitest";
import { z } from "zod";
import { registry } from "../__fixtures__/miniApp";
import { CapabilityRegistry, createRegistry, registryCompleteness } from "./registry";

describe("CapabilityRegistry", () => {
  it("looks up capabilities and actions", () => {
    expect(registry.get("kpi")?.risk).toBe("low");
    expect(registry.types()).toEqual(["kpi", "table", "action", "secret"]);
    expect(registry.capabilities()).toHaveLength(4);
    expect(registry.action("email")?.label).toBe("Email");
    expect(registry.actions()).toHaveLength(2);
    expect(registry.actionIds()).toEqual(["email", "wipe"]);
  });
  it("validates props with Zod and never throws", () => {
    expect(registry.validateProps("kpi", { label: "R", value: 3 })).toEqual({
      ok: true,
      props: { label: "R", value: 3 },
    });
    const bad = registry.validateProps("kpi", { label: "R", value: "3" });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toContain("value");
    expect(registry.validateProps("nope", {})).toMatchObject({ ok: false });
    expect(registry.validateProps("secret", 5)).toMatchObject({
      ok: false,
      error: expect.stringContaining("(props)"),
    });
  });
  it("rejects duplicates", () => {
    const cap = { type: "x", description: "X", props: z.object({}), risk: "low" as const };
    expect(() => createRegistry([cap, cap])).toThrow(/twice/);
    const act = { id: "a", label: "A", risk: "low" as const, capability: "action" as const };
    expect(() => new CapabilityRegistry([], [act, act])).toThrow(/twice/);
  });
  it("asserts registry/renderer completeness", () => {
    expect(registryCompleteness(registry, ["kpi", "table", "action", "secret"])).toEqual([]);
    expect(registryCompleteness(registry, ["kpi", "table", "action", "chart"])).toEqual([
      'No renderer for capability "secret".',
      'Renderer "chart" has no registered capability.',
    ]);
  });
});
