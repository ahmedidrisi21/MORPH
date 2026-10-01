// Golden scenario runner (SPEC §13.3). Pure Node; used by golden.golden.test.ts.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Answers,
  CompositeProvider,
  type DecisionBatch,
  type DecisionProvider,
  type DecisionTrace,
  type FixtureStore,
  type GateOutcome,
  type MorphContext,
  type MorphUIState,
  memoryFixtureStore,
  pushHistory,
  ReplayProvider,
  RingBufferSink,
  type UIDiffOp,
} from "@morph/core";
import { z } from "zod";
import { customerNames, parseSalesCsv, type SalesFacts, tsFactsEngine } from "../lib/facts";
import { createDemoMorph, createRulesProvider } from "../lib/morph";

const root = new URL("../../../", import.meta.url).pathname;
export const GOLDEN_DIR = join(root, "fixtures/golden");
export const REPLAY_DIR = join(root, "fixtures/replay");

const Expect = z
  .object({
    outcome: z.array(z.string()).optional(),
    outcomeNot: z.array(z.string()).optional(),
    workspaceIn: z.array(z.string()).optional(),
    workspaceNotIn: z.array(z.string()).optional(),
    mustInclude: z.array(z.string()).optional(),
    mustNotInclude: z.array(z.string()).optional(),
    filter: z.string().optional(),
    workspaceUnchanged: z.boolean().optional(),
    workspaceChanged: z.boolean().optional(),
    emptyDiff: z.boolean().optional(),
    policyDenied: z.array(z.string()).optional(),
    sameAs: z.string().optional(),
    untrustedNotInLens: z.boolean().optional(),
    fallbackRecorded: z.boolean().optional(),
    notBlank: z.boolean().optional(),
    optionsCount: z.number().optional(),
    overrideEvent: z.boolean().optional(),
    providerCalls: z.number().optional(),
  })
  .strict();
export type GoldenExpect = z.infer<typeof Expect>;

const Turn = z
  .object({
    intent: z.string().optional(),
    choose: z.number().int().min(0).optional(),
    expect: Expect.optional(),
    rulesExpect: Expect.optional(),
  })
  .strict()
  .refine(
    (t) => (t.intent === undefined) !== (t.choose === undefined),
    "a turn has either intent or choose",
  );

export const GoldenSchema = z
  .object({
    id: z.string().regex(/^G\d{2}-[a-z0-9-]+$/),
    description: z.string(),
    given: z
      .object({
        user: z.object({ role: z.string(), permissions: z.array(z.string()) }),
        ui: z.object({ workspaceId: z.string() }),
        untrustedInjection: z.string().optional(),
        providerFailure: z.array(z.enum(["throw", "timeout"])).optional(),
        provider: z.enum(["uncalibrated-confident"]).optional(),
      })
      .strict(),
    turns: z.array(Turn).min(1),
  })
  .strict();
export type Golden = z.infer<typeof GoldenSchema>;

export function loadGoldens(): Golden[] {
  return readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => GoldenSchema.parse(JSON.parse(readFileSync(join(GOLDEN_DIR, f), "utf8"))));
}

let cachedFacts: { facts: SalesFacts; names: Record<string, string> } | null = null;
export function loadDemoData() {
  if (!cachedFacts) {
    const rows = parseSalesCsv(readFileSync(join(root, "apps/demo/data/sales.csv"), "utf8"));
    cachedFacts = { facts: tsFactsEngine.computeSync(rows), names: customerNames(rows) };
  }
  return cachedFacts;
}

export type ProviderMode = "rules" | "replay" | "live";

/** Counts provider calls (one per batch request). */
export class CountingProvider implements DecisionProvider {
  readonly name: string;
  readonly calibrated: boolean;
  calls = 0;
  constructor(readonly inner: DecisionProvider) {
    this.name = inner.name;
    this.calibrated = inner.calibrated;
  }
  async evaluate(batch: DecisionBatch): Promise<Answers> {
    this.calls++;
    return this.inner.evaluate(batch);
  }
  async evaluateWithReport(batch: DecisionBatch) {
    this.calls++;
    const r = this.inner as Partial<{
      evaluateWithReport: (b: DecisionBatch) => Promise<{ answers: Answers; attempts: [] }>;
    }>;
    if (r.evaluateWithReport) return r.evaluateWithReport(batch);
    return {
      answers: await this.inner.evaluate(batch),
      attempts: [{ provider: this.inner.name, model: null, latencyMs: 0, ok: true }],
    };
  }
}

/** Always throws, or never answers until aborted (simulated Jev outage). */
export function failingProvider(kind: "throw" | "timeout"): DecisionProvider {
  return {
    name: "jev",
    calibrated: true,
    evaluate: (batch) =>
      kind === "throw"
        ? Promise.reject(new Error("simulated Jev outage"))
        : new Promise<Answers>((_, reject) => {
            batch.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
  };
}

/** Rules with every distribution sharpened to 99% but still uncalibrated (G13). */
export function uncalibratedConfidentProvider(): DecisionProvider {
  const rules = createRulesProvider();
  return {
    name: "uncalibrated",
    calibrated: false,
    evaluate: async (batch) => {
      const answers = await rules.evaluate(batch);
      for (const [id, a] of Object.entries(answers)) {
        if (a.kind === "choice") {
          const keys = Object.keys(a.probabilities);
          const p: Record<string, number> = {};
          for (const k of keys) p[k] = k === a.value ? 0.99 : 0.01 / (keys.length - 1);
          answers[id] = { ...a, probabilities: p, confidence: 0.99 };
        }
      }
      return answers;
    },
  };
}

export interface ScenarioOptions {
  mode: ProviderMode;
  /** Fixture store for replay/record. */
  store?: FixtureStore;
  /** Live provider (JevProvider), used when mode = "live". */
  live?: DecisionProvider;
  record?: boolean;
  jevModel?: string;
  failure?: "throw" | "timeout";
}

export interface TurnResult {
  outcome: GateOutcome;
  state: MorphUIState;
  prev: MorphUIState;
  diff: UIDiffOp[];
  trace: DecisionTrace | null;
  providerCalls: number;
  events: ReturnType<RingBufferSink["events"]>;
}

export function buildProvider(
  g: Golden,
  opts: ScenarioOptions,
  failure?: "throw" | "timeout",
): DecisionProvider {
  const rules = createRulesProvider();
  if (g.given.provider === "uncalibrated-confident") return uncalibratedConfidentProvider();
  if (failure) return new CompositeProvider([failingProvider(failure), rules], { budgetMs: 300 });
  const key = { provider: "jev", model: opts.jevModel ?? "jev-1.13.0" };
  if (opts.mode === "replay") {
    return new ReplayProvider({ store: opts.store ?? memoryFixtureStore(), mode: "replay", key });
  }
  if (opts.mode === "live" && opts.live) {
    if (opts.record)
      return new ReplayProvider({
        store: opts.store ?? memoryFixtureStore(),
        mode: "record",
        inner: opts.live,
        key,
      });
    return opts.live;
  }
  return rules;
}

/** Run a scenario's turns; returns per-turn results. Throws only on runner misuse. */
export async function runScenario(g: Golden, opts: ScenarioOptions): Promise<TurnResult[]> {
  const { facts, names } = loadDemoData();
  const untrusted: Record<string, string> = { ...names };
  if (g.given.untrustedInjection) untrusted.c_injected = g.given.untrustedInjection;
  const provider = new CountingProvider(buildProvider(g, opts, opts.failure));
  const sink = new RingBufferSink();
  let now = Date.UTC(2026, 8, 1);
  let seq = 0;
  const morph = createDemoMorph({
    provider,
    traceSink: sink,
    clock: () => now,
    idGen: () => `${g.id}-t${seq++}`,
    traceFull: true,
  });
  const baseCtx = (): Omit<MorphContext, "intent"> => ({
    user: g.given.user,
    facts,
    untrusted: { customerNames: untrusted },
    ui: { workspaceId: null, componentIds: [], lastMorphAt: null, activeFilter: null },
    now,
  });
  morph.setState(
    morph.composeLeaf(g.given.ui.workspaceId, { ...baseCtx(), intent: { raw: "", history: [] } }),
  );
  let history: string[] = [];
  let lastMorphAt: number | null = null;
  const results: TurnResult[] = [];
  for (const turn of g.turns) {
    now += 5_000;
    const prev = morph.getState() as MorphUIState;
    const before = provider.calls;
    if (turn.intent !== undefined) {
      const ctx: MorphContext = {
        ...baseCtx(),
        intent: { raw: turn.intent, history },
        ui: {
          workspaceId: prev.workspaceId,
          componentIds: prev.components.map((c) => c.id),
          lastMorphAt,
          activeFilter: prev.filter,
        },
      };
      const r = await morph.resolve(ctx, { trigger: "intent" });
      history = pushHistory(history, turn.intent);
      // The runner accepts pending outcomes with their first option (SPEC §13.3) for later turns.
      let state = r.state;
      if (r.outcome.kind === "auto" || r.outcome.kind === "refine") lastMorphAt = now;
      results.push({
        outcome: r.outcome,
        state,
        prev,
        diff: r.diff,
        trace: r.trace,
        providerCalls: provider.calls - before,
        events: sink.events(),
      });
      if (r.outcome.kind === "confirm") state = morph.confirm(r.trace.id, true).state;
      else if (
        r.outcome.kind === "alternates" &&
        g.turns[g.turns.indexOf(turn) + 1]?.choose === undefined
      ) {
        state = morph.override(r.trace.id, r.outcome.options[0].leafId, "alternate").state;
      }
      if (state !== r.state) lastMorphAt = now;
    } else {
      const pending = prev.pending;
      const option = pending?.options[turn.choose ?? 0];
      if (!option) throw new Error(`${g.id}: no pending option ${turn.choose} to choose`);
      const r = morph.override(
        prev.traceId,
        option.leafId,
        pending?.kind === "clarify" ? "clarify" : "alternate",
      );
      results.push({
        outcome: {
          kind: "auto",
          target: { leafId: option.leafId, path: [], score: 0, edgeConfidences: [] },
        },
        state: r.state,
        prev,
        diff: r.diff,
        trace: null,
        providerCalls: provider.calls - before,
        events: sink.events(),
      });
    }
  }
  return results;
}

/** The workspace a turn results in, "as the test runner accepts it" (first option for confirm/alternates). */
export function acceptedWorkspace(r: TurnResult): string {
  const o = r.outcome;
  if (o.kind === "confirm") return o.target.leafId;
  if (o.kind === "alternates") return o.options[0].leafId;
  return r.state.workspaceId;
}

function includes(state: MorphUIState, needle: string): boolean {
  return state.components.some(
    (c) => c.type === needle || c.id.endsWith(`:${needle}`) || c.id.includes(`:${needle}:`),
  );
}

/** Check one turn against its expectations. Returns failure messages (empty = pass). */
export function checkTurn(r: TurnResult, e: GoldenExpect, ref?: TurnResult): string[] {
  const f: string[] = [];
  const ws = acceptedWorkspace(r);
  if (e.outcome && !e.outcome.includes(r.outcome.kind))
    f.push(`outcome ${r.outcome.kind} not in [${e.outcome}]`);
  if (e.outcomeNot?.includes(r.outcome.kind)) f.push(`outcome ${r.outcome.kind} is forbidden`);
  if (e.workspaceIn && !e.workspaceIn.includes(ws))
    f.push(`workspace ${ws} not in [${e.workspaceIn}]`);
  if (e.workspaceNotIn?.some((w) => ws.startsWith(w))) f.push(`workspace ${ws} is forbidden`);
  for (const m of e.mustInclude ?? [])
    if (!includes(r.state, m) && ws === r.state.workspaceId) f.push(`missing component ${m}`);
  for (const m of e.mustNotInclude ?? []) {
    if (includes(r.state, m)) f.push(`forbidden component ${m} rendered`);
    if (r.state.pending?.options.some((o) => o.leafId.includes(m)))
      f.push(`forbidden option ${m} offered`);
  }
  if (e.filter !== undefined && r.state.filter !== e.filter)
    f.push(`filter ${r.state.filter} ≠ ${e.filter}`);
  if (e.workspaceUnchanged && r.state.workspaceId !== r.prev.workspaceId)
    f.push(`workspace changed ${r.prev.workspaceId} → ${r.state.workspaceId}`);
  if (e.workspaceChanged && r.state.workspaceId === r.prev.workspaceId)
    f.push("workspace did not change");
  if (e.emptyDiff && r.diff.length) f.push(`diff not empty (${r.diff.length} ops)`);
  for (const p of e.policyDenied ?? []) {
    const denied = r.trace?.policy.some((d) => !d.decision.allowed && d.subject.includes(p));
    if (!denied) f.push(`no policy denial for ${p} in trace`);
  }
  if (e.untrustedNotInLens) {
    const lens = JSON.stringify(r.trace?.lensStates ?? {});
    if (!lens.includes("intent")) f.push("lens content missing from trace (traceFull)");
    if (/ignore previous instructions/i.test(lens)) f.push("untrusted data reached a lens");
  }
  if (e.sameAs && ref) {
    if (r.outcome.kind !== ref.outcome.kind)
      f.push(`outcome ${r.outcome.kind} ≠ ${e.sameAs} ${ref.outcome.kind}`);
    if (acceptedWorkspace(r) !== acceptedWorkspace(ref))
      f.push(`workspace differs from ${e.sameAs}`);
  }
  if (e.fallbackRecorded && !r.trace?.batches.some((b) => b.fallbackFrom !== undefined))
    f.push("no fallback recorded in trace");
  if (e.notBlank && r.state.components.length === 0) f.push("workspace is blank");
  if (e.optionsCount !== undefined) {
    const n =
      r.outcome.kind === "alternates"
        ? r.outcome.options.length
        : (r.state.pending?.options.length ?? 0);
    if (n !== e.optionsCount) f.push(`${n} options ≠ ${e.optionsCount}`);
  }
  if (e.overrideEvent && !r.events.some((ev) => ev.type === "override"))
    f.push("no override event");
  if (e.providerCalls !== undefined && r.providerCalls !== e.providerCalls)
    f.push(`${r.providerCalls} provider calls ≠ ${e.providerCalls}`);
  return f;
}
