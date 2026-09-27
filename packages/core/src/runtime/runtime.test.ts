import { describe, expect, it } from "vitest";
import {
  facts,
  makeCtx,
  registry,
  rules,
  rulesProvider,
  specs,
  templates,
  tree,
} from "../__fixtures__/miniApp";
import type { MorphContext } from "../context/types";
import type { Answers } from "../decisions/answer";
import { CompositeProvider } from "../providers/composite";
import { ProviderError } from "../providers/errors";
import { RulesProvider } from "../providers/rules";
import { type DecisionBatch, type DecisionProvider, evaluateReported } from "../providers/types";
import { RingBufferSink } from "../trace/sink";
import { createMorph, type Morph, type MorphConfig } from "./createMorph";

class Counting implements DecisionProvider {
  readonly name: string;
  readonly calibrated: boolean;
  calls = 0;
  constructor(readonly inner: DecisionProvider) {
    this.name = inner.name;
    this.calibrated = inner.calibrated;
  }
  async evaluate(b: DecisionBatch): Promise<Answers> {
    return (await this.evaluateWithReport(b)).answers;
  }
  async evaluateWithReport(b: DecisionBatch) {
    this.calls++;
    return evaluateReported(this.inner, b);
  }
}

function setup(over: Partial<MorphConfig> = {}) {
  let now = 1_000_000;
  let id = 0;
  const provider = new Counting(over.provider ?? rulesProvider());
  const sink = new RingBufferSink();
  const morph = createMorph({
    registry,
    templates,
    tree,
    specs,
    traceSink: sink,
    clock: () => now,
    idGen: () => `t${id++}`,
    ...over,
    provider,
  });
  morph.setState(morph.composeLeaf("overview.default", makeCtx("")));
  const ctx = (intent: string, extra: Partial<MorphContext> = {}): MorphContext => {
    const s = morph.getState();
    return makeCtx(intent, {
      ui: {
        workspaceId: s?.workspaceId ?? null,
        componentIds: [],
        lastMorphAt: null,
        activeFilter: s?.filter ?? null,
      },
      now,
      ...extra,
    });
  };
  return { morph, provider, sink, ctx, tick: (ms: number) => (now += ms) };
}

const turn = (m: Morph, c: MorphContext) => m.resolve(c, { trigger: "intent" });

describe("createMorph.resolve", () => {
  it("runs one provider request per turn and morphs on a clear intent", async () => {
    const { morph, provider, ctx } = setup();
    const r = await turn(morph, ctx("Why did revenue fall?"));
    expect(provider.calls).toBe(1);
    expect(r.outcome.kind).toBe("auto");
    expect(r.state.workspaceId).toBe("investigation.by_time");
    expect(r.diff.length).toBeGreaterThan(0);
    expect(r.trace.batches).toHaveLength(1);
    expect(r.trace.batches[0]?.specIds).toEqual(
      expect.arrayContaining(["turn_type", "ws.root", "ws.investigation"]),
    );
    expect(r.trace.lensStates.core?.content).toBeUndefined();
    expect(r.trace.pruned).toEqual([
      { leafId: "customers.at_risk", reason: "missing data: has_churn_model" },
    ]);
    expect(r.trace.policy.some((p) => !p.decision.allowed)).toBe(true);
    expect(r.trace.result).toEqual({ workspaceId: "investigation.by_time", filter: null });
    expect(r.state.alternates.length).toBeLessThanOrEqual(2);
  });

  it("the same intent twice stays with an empty diff", async () => {
    const { morph, ctx } = setup();
    await turn(morph, ctx("Why did revenue fall?"));
    const r = await turn(morph, ctx("Why did revenue fall?"));
    expect(r.outcome).toMatchObject({ kind: "stay" });
    expect(r.diff).toEqual([]);
  });

  it("refines in place with a filter", async () => {
    const { morph, ctx } = setup();
    morph.setState(morph.composeLeaf("customers.list", makeCtx("")));
    const r = await turn(morph, ctx("Only show customers I can save."));
    expect(r.outcome).toEqual({ kind: "refine", filter: "recoverable" });
    expect(r.state).toMatchObject({ workspaceId: "customers.list", filter: "recoverable" });
    expect(r.diff).toEqual([
      { op: "update", id: "customers.list:table:customers", changedProps: ["rows"] },
    ]);
  });

  it("clarifies vague intents without changing the workspace", async () => {
    const { morph, ctx } = setup();
    const r = await turn(morph, ctx("hello"));
    expect(r.outcome.kind).toBe("clarify");
    expect(r.state.pending?.kind).toBe("clarify");
    expect(r.diff).toEqual([]);
  });

  it("offers alternates and overrides locally with no provider call", async () => {
    const { morph, provider, ctx, sink } = setup();
    const churn = {
      ...facts,
      capabilities: [...facts.capabilities, { id: "has_churn_model", description: "Churn" }],
    };
    const r = await turn(morph, ctx("look into customers", { facts: churn }));
    expect(r.outcome.kind).toBe("alternates");
    expect(r.state.pending?.options).toHaveLength(2);
    const calls = provider.calls;
    const target = r.state.pending?.options[1]?.leafId as string;
    const o = morph.override(r.trace.id, target);
    expect(provider.calls).toBe(calls);
    expect(o.state.workspaceId).toBe(target);
    expect(sink.events().at(-1)).toMatchObject({ type: "override", via: "alternate", to: target });
    expect(() => morph.override("nope", target)).toThrow(/Unknown trace/);
    expect(() => morph.override(r.trace.id, "nope")).toThrow(/Unknown workspace/);
  });

  it("confirms medium-risk leaves from an uncalibrated provider, then applies on yes", async () => {
    const { morph, provider, ctx, sink } = setup();
    const r = await turn(morph, ctx("What should I do?"));
    expect(r.outcome.kind).toBe("confirm");
    expect(r.state.workspaceId).toBe("overview.default");
    const calls = provider.calls;
    const yes = morph.confirm(r.trace.id, true);
    expect(yes.state.workspaceId).toBe("action.recommendations");
    expect(provider.calls).toBe(calls);
    expect(sink.events().at(-1)).toMatchObject({ type: "confirm", accepted: true });
    const again = morph.confirm(r.trace.id, true);
    expect(again.state.pending).toBeNull();
  });

  it("declining a confirm keeps the workspace", async () => {
    const { morph, ctx } = setup();
    const r = await turn(morph, ctx("What should I do?"));
    const no = morph.confirm(r.trace.id, false);
    expect(no.state).toMatchObject({ workspaceId: "overview.default", pending: null });
  });

  it("undo restores the previous workspace", async () => {
    const { morph, ctx, sink } = setup();
    expect(morph.canUndo()).toBe(false);
    expect(morph.undo()).toBeNull();
    await turn(morph, ctx("Why did revenue fall?"));
    expect(morph.canUndo()).toBe(true);
    const u = morph.undo();
    expect(u?.state.workspaceId).toBe("overview.default");
    expect(sink.events().at(-1)).toMatchObject({ type: "override", via: "undo" });
  });

  it("falls back from a failing provider to rules and records it", async () => {
    const failing: DecisionProvider = {
      name: "jev",
      calibrated: true,
      evaluate: async () => {
        throw new ProviderError("jev", "timeout");
      },
    };
    const { morph, ctx } = setup({
      provider: new CompositeProvider([failing, new RulesProvider({ rules })]),
    });
    const r = await turn(morph, ctx("Why did revenue fall?"));
    expect(
      r.trace.batches.map((b) => [b.provider, b.fallbackFrom ?? null, Boolean(b.error)]),
    ).toEqual([
      ["jev", null, true],
      ["rules", "jev", false],
    ]);
    expect(r.state.components.length).toBeGreaterThan(0);
  });

  it("keeps the current UI when every provider fails", async () => {
    const failing: DecisionProvider = {
      name: "down",
      calibrated: true,
      evaluate: async () => {
        throw new Error("down");
      },
    };
    const { morph, ctx } = setup({ provider: failing });
    const r = await turn(morph, ctx("Why did revenue fall?"));
    expect(r.outcome).toEqual({ kind: "stay", reason: "provider failure" });
    expect(r.state.workspaceId).toBe("overview.default");
    expect(r.state.components.length).toBeGreaterThan(0);
    expect(r.trace.error).toContain("down");
  });

  it("uses the cache across turns and can disable it", async () => {
    const a = setup();
    await turn(a.morph, a.ctx("hello"));
    await turn(a.morph, a.ctx("hello"));
    expect(a.provider.calls).toBe(1);
    const b = setup({ cache: false });
    await turn(b.morph, b.ctx("hello"));
    await turn(b.morph, b.ctx("hello"));
    expect(b.provider.calls).toBe(2);
  });

  it("includes lens content only with traceFull", async () => {
    const { morph, ctx } = setup({ traceFull: true });
    const r = await turn(morph, ctx("hello"));
    expect(r.trace.lensStates.core?.content).toMatchObject({ intent: "hello" });
    expect(JSON.stringify(r.trace)).not.toContain("Ignore previous instructions");
  });

  it("re-gates when a required component is denied after compose", async () => {
    let calls = 0;
    const flaky = {
      canRender: (cap: { type: string }) => {
        if (cap.type === "kpi") calls++;
        // Allow during pruning (first pass), deny the investigation KPI during compose.
        const deny = cap.type === "kpi" && calls > 6;
        return { allowed: !deny, rule: "flaky", reason: deny ? "denied late" : "ok" };
      },
      canAct: () => ({ allowed: true, rule: "ok", reason: "ok" }),
    };
    const { morph, ctx } = setup({ policy: flaky });
    const r = await turn(morph, ctx("Why did revenue fall?"));
    expect(r.trace.gate.reason).toContain("invalid after policy");
  });

  it("prunes leaves whose required components policy denies", async () => {
    const denyTables = {
      canRender: (cap: { type: string }) => ({
        allowed: cap.type !== "kpi",
        rule: "no_kpi",
        reason: "no kpis",
      }),
      canAct: () => ({ allowed: true, rule: "ok", reason: "ok" }),
    };
    const { morph, ctx } = setup({ policy: denyTables });
    const r = await turn(morph, ctx("Why did revenue fall?"));
    expect(r.trace.pruned.length).toBe(6);
    expect(r.outcome).toMatchObject({ kind: "stay", reason: "provider failure" });
  });

  it("cooldown blocks non-intent triggers", async () => {
    const { morph, ctx } = setup();
    const r = await morph.resolve(
      ctx("Why did revenue fall?", {
        ui: {
          workspaceId: "overview.default",
          componentIds: [],
          lastMorphAt: 1_000_000,
          activeFilter: null,
        },
      }),
      { trigger: "data" },
    );
    expect(r.outcome).toMatchObject({ kind: "stay", reason: "cooldown" });
  });

  it("validates configuration", () => {
    expect(() =>
      createMorph({
        registry,
        templates: templates.slice(1),
        tree,
        specs,
        provider: rulesProvider(),
      }),
    ).toThrow(/No template/);
    expect(() =>
      createMorph({
        registry,
        templates,
        tree,
        specs: [{ ...specs[0]!, id: "Bad" }],
        provider: rulesProvider(),
      }),
    ).toThrow();
  });

  it("composes the first candidate when there is no current state", async () => {
    const morph = createMorph({ registry, templates, tree, specs, provider: rulesProvider() });
    const r = await morph.resolve(
      makeCtx("hello", {
        ui: { workspaceId: null, componentIds: [], lastMorphAt: null, activeFilter: null },
      }),
    );
    expect(r.state.components.length).toBeGreaterThan(0);
    expect(morph.getTrace(r.trace.id)?.id).toBe(r.trace.id);
    expect(morph.config.floor).toBe(0.5);
    let n = 0;
    const off = morph.subscribe(() => n++);
    morph.emit({ type: "task_complete", traceId: r.trace.id, task: "x" });
    off();
    expect(n).toBe(1);
    expect(() => morph.composeLeaf("nope", makeCtx(""))).toThrow();
  });

  it("uses level-wise search for large trees", async () => {
    const { morph, provider, ctx } = setup({ gate: { fullTreeMaxNodes: 1 } });
    const r = await turn(morph, ctx("Why did revenue fall?"));
    expect(provider.calls).toBeGreaterThan(1);
    expect(r.state.workspaceId).toBe("investigation.by_time");
  });

  it("facts stay untouched", () => {
    expect(facts.items.length).toBe(2);
  });
});
