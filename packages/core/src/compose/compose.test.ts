import { describe, expect, it } from "vitest";
import { facts, makeCtx, registry, templates } from "../__fixtures__/miniApp";
import type { Answers } from "../decisions/answer";
import { defaultPolicy } from "../policy/policy";
import { compose, densityFrom, sortComponents } from "./compose";
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
