import { describe, expect, it } from "vitest";
import { facts, makeCtx, registry, registryWithActions, templates } from "../__fixtures__/miniApp";
import type { Answers } from "../decisions/answer";
import { defaultPolicy } from "../policy/policy";
import { checkActions, compose, densityFrom, sortComponents } from "./compose";
import type { WorkspaceTemplate } from "./types";

const t = (id: string) => templates.find((x) => x.leafId === id) as WorkspaceTemplate;
const base = {
  facts,
  answers: {},
  ctx: makeCtx("x"),
  registry,
  policy: defaultPolicy,
  traceId: "t1",
};

describe("compose", () => {
  it("builds, sorts and applies supported filters", () => {
    const r = compose({ ...base, template: t("investigation.by_customer"), filter: "recoverable" });
    expect(r.state).toMatchObject({
      workspaceId: "investigation.by_customer",
      layout: "investigation",
      filter: "recoverable",
      density: 1,
    });
    expect(r.state.components.map((c) => c.type)).toEqual(["kpi", "table"]);
    expect(r.state.components[1]?.props).toEqual({ rows: ["c2"] });
    expect(r.invalid).toBe(false);
  });
  it("ignores unsupported filters", () => {
    expect(
      compose({ ...base, template: t("investigation.by_time"), filter: "recoverable" }).state
        .filter,
    ).toBeNull();
  });
  it("removes denied components and records the policy decision", () => {
    const r = compose({ ...base, template: t("overview.default"), filter: null });
    expect(r.state.components.map((c) => c.type)).toEqual(["kpi"]);
    expect(r.removed).toEqual(["overview.default:secret:payroll"]);
    expect(r.policy[0]?.decision.allowed).toBe(false);
  });
  it("marks candidates invalid when a required component is removed", () => {
    const tpl: WorkspaceTemplate = {
      ...t("overview.default"),
      required: ["overview.default:secret:payroll"],
    };
    expect(compose({ ...base, template: tpl, filter: null }).invalid).toBe(true);
  });
  it("removes unknown capability types and records invalid props", () => {
    const tpl: WorkspaceTemplate = {
      ...t("investigation.by_time"),
      build: () => [
        { id: "a:kpi:x", type: "kpi", props: { label: 1 }, slot: "main", priority: 0 },
        { id: "a:ghost:x", type: "ghost", props: {}, slot: "main", priority: 1 },
      ],
      required: [],
    };
    const r = compose({ ...base, template: tpl, filter: null });
    expect(r.removed).toEqual(["a:ghost:x"]);
    expect(r.validation).toHaveLength(1);
    expect(r.state.components).toHaveLength(1);
  });
  describe("actions", () => {
    // sales_manager has read:sales only: "email" is allowed, "wipe" needs admin, "ghost" is unknown.
    const actionBase = { ...base, registry: registryWithActions };
    const withActions = (actions: string[], required: string[] = []): WorkspaceTemplate => ({
      ...t("investigation.by_time"),
      required,
      build: () => [
        {
          id: "a:kpi:x",
          type: "kpi",
          props: { label: "x", value: 1 },
          slot: "header",
          priority: 0,
        },
        { id: "a:actions:main", type: "actions", props: { actions }, slot: "main", priority: 1 },
      ],
    });
    const actionsOf = (r: ReturnType<typeof compose>) =>
      (
        r.state.components.find((c) => c.id === "a:actions:main")?.props as
          | { actions: string[] }
          | undefined
      )?.actions;

    it("keeps the permitted actions and records each denial", () => {
      const r = compose({ ...actionBase, template: withActions(["email", "wipe"]), filter: null });
      expect(actionsOf(r)).toEqual(["email"]);
      expect(r.removed).toEqual([]);
      expect(r.invalid).toBe(false);
      expect(r.policy).toHaveLength(1);
      expect(r.policy[0]).toMatchObject({
        subject: "a:actions:main/action:wipe",
        decision: { allowed: false, rule: "permission" },
      });
    });
    it("leaves props untouched when every action is allowed", () => {
      const r = compose({ ...actionBase, template: withActions(["email"]), filter: null });
      expect(actionsOf(r)).toEqual(["email"]);
      expect(r.policy).toEqual([]);
    });
    it("removes a component whose actions are all denied, and invalidates the candidate if required", () => {
      const tpl = withActions(["wipe"], ["a:actions:main"]);
      const r = compose({ ...actionBase, template: tpl, filter: null });
      expect(actionsOf(r)).toBeUndefined();
      expect(r.removed).toEqual(["a:actions:main"]);
      expect(r.invalid).toBe(true);
      expect(
        compose({ ...actionBase, template: withActions(["wipe"]), filter: null }).invalid,
      ).toBe(false);
    });
    it("denies an action the registry does not know", () => {
      const r = compose({ ...actionBase, template: withActions(["email", "ghost"]), filter: null });
      expect(actionsOf(r)).toEqual(["email"]);
      expect(r.policy[0]?.decision).toMatchObject({ allowed: false, rule: "registry" });
    });
    it("lets a user with the permission see the action", () => {
      const ctx = makeCtx("x", { user: { role: "admin", permissions: ["admin"] } });
      const r = compose({
        ...actionBase,
        ctx,
        template: withActions(["email", "wipe"]),
        filter: null,
      });
      expect(actionsOf(r)).toEqual(["email", "wipe"]);
    });
    it("does nothing for a capability without the hook", () => {
      const kpi = registry.get("kpi") as NonNullable<ReturnType<typeof registry.get>>;
      const c = checkActions("k", kpi, { label: "x", value: 1 }, base.ctx, registry, defaultPolicy);
      expect(c).toEqual({
        props: { label: "x", value: 1 },
        changed: false,
        empty: false,
        policy: [],
      });
    });
  });
  it("uses density from the score answer", () => {
    const meta = { provider: "t", model: null, calibrated: true, latencyMs: 0, cached: false };
    const answers: Answers = {
      density: {
        kind: "score",
        expected: 0.2,
        probabilities: { 0: 0.8, 1: 0.1, 2: 0.1 },
        confidence: 0.8,
        meta,
      },
    };
    expect(densityFrom(answers)).toBe(0);
    expect(densityFrom({})).toBe(1);
    const r = compose({ ...base, answers, template: t("investigation.by_time"), filter: null });
    expect(r.state.components).toHaveLength(1);
  });
  it("sorts by slot, then priority, then id", () => {
    const sorted = sortComponents([
      { id: "b", type: "kpi", props: {}, slot: "main", priority: 0 },
      { id: "a", type: "kpi", props: {}, slot: "main", priority: 0 },
      { id: "c", type: "kpi", props: {}, slot: "header", priority: 9 },
      { id: "d", type: "kpi", props: {}, slot: "footer", priority: 0 },
      { id: "e", type: "kpi", props: {}, slot: "side", priority: 0 },
    ]);
    expect(sorted.map((c) => c.id)).toEqual(["c", "a", "b", "e", "d"]);
  });
});
