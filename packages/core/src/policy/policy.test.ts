import { describe, expect, it } from "vitest";
import { makeCtx, registry } from "../__fixtures__/miniApp";
import { composePolicies, defaultPolicy, type Policy, requiresConfirmation } from "./policy";

describe("defaultPolicy", () => {
  const ctx = makeCtx("x");
  it("denies capabilities without the permission", () => {
    const d = defaultPolicy.canRender(registry.get("secret")!, ctx);
    expect(d).toMatchObject({ allowed: false, rule: "permission" });
    expect(d.reason).toContain("read:payroll");
    expect(defaultPolicy.canRender(registry.get("kpi")!, ctx).allowed).toBe(true);
    const payroll = { ...ctx, user: { ...ctx.user, permissions: ["read:payroll"] } };
    expect(defaultPolicy.canRender(registry.get("secret")!, payroll).allowed).toBe(true);
  });
  it("checks action permissions and critical confirmation", () => {
    expect(defaultPolicy.canAct(registry.action("wipe")!, ctx).allowed).toBe(false);
    expect(defaultPolicy.canAct(registry.action("email")!, ctx).allowed).toBe(true);
    expect(requiresConfirmation(registry.action("wipe")!)).toBe(true);
    expect(requiresConfirmation(registry.action("email")!)).toBe(false);
  });
  it("never reads untrusted data", () => {
    const ctx2 = makeCtx("x");
    const trap = new Proxy(
      {},
      {
        get: () => {
          throw new Error("policy read untrusted");
        },
      },
    );
    ctx2.untrusted = trap as Record<string, never>;
    expect(() => defaultPolicy.canRender(registry.get("kpi")!, ctx2)).not.toThrow();
  });
});

describe("composePolicies", () => {
  const denyTables: Policy = {
    canRender: (cap) => ({
      allowed: cap.type !== "table",
      rule: "no_tables",
      reason: "Tables are off.",
    }),
    canAct: () => ({ allowed: true, rule: "ok", reason: "ok" }),
  };
  it("returns the first denial", () => {
    const p = composePolicies(defaultPolicy, denyTables);
    const ctx = makeCtx("x");
    expect(p.canRender(registry.get("table")!, ctx).rule).toBe("no_tables");
    expect(p.canRender(registry.get("secret")!, ctx).rule).toBe("permission");
    expect(p.canRender(registry.get("kpi")!, ctx).allowed).toBe(true);
    expect(p.canAct(registry.action("email")!, ctx).allowed).toBe(true);
    expect(composePolicies().canRender(registry.get("kpi")!, ctx).rule).toBe("none");
  });
});
