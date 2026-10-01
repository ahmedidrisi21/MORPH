import { type CacheStore, LruCache } from "../cache/lru";
import { type ComposeResult, compose, densityFrom } from "../compose/compose";
import type { MorphUIState, PendingOption, WorkspaceTemplate } from "../compose/types";
import { defaultLenses, type Lens, type LensId } from "../context/lens";
import { type MorphContext, maxRisk, type RiskLevel, type Trigger } from "../context/types";
import type { Answers } from "../decisions/answer";
import { type BatchLogEntry, execute, plan } from "../decisions/planner";
import { type DecisionSpec, validateSpecs } from "../decisions/spec";
import { diff, type UIDiffOp } from "../diff/diff";
import { hasCapability } from "../facts/types";
import {
  type GateConfig,
  type GateOutcome,
  type GateResult,
  resolveGateConfig,
  runGate,
} from "../gate/gate";
import { defaultPolicy, type Policy, type PolicyDecision } from "../policy/policy";
import { errorMessage } from "../providers/errors";
import type { DecisionProvider } from "../providers/types";
import type { CapabilityRegistry } from "../registry/registry";
import {
  beamSearch,
  beamSearchLevelwise,
  type Candidate,
  leafScore,
  pathConfidence,
} from "../resolver/beam";
import { pruneTree } from "../resolver/prune";
import { buildTreeQuestions } from "../resolver/questions";
import { decisionNodes, findNode, leaves, type TreeNode, validateTree } from "../resolver/tree";
import { RingBufferSink } from "../trace/sink";
import type { DecisionTrace, MorphEvent, TraceSink } from "../trace/types";

export interface MorphConfig {
  registry: CapabilityRegistry;
  templates: WorkspaceTemplate[];
  tree: TreeNode;
  specs: DecisionSpec[];
  provider: DecisionProvider;
  lenses?: Record<LensId, Lens>;
  policy?: Policy;
  gate?: Partial<GateConfig>;
  /** Answer cache; `false` disables it. Default: in-memory LRU (500 entries, 10 min). */
  cache?: CacheStore | false;
  traceSink?: TraceSink;
  clock?: () => number;
  idGen?: () => string;
  /** Include lens state content in traces (MORPH_DEV_TRACE_FULL=1). */
  traceFull?: boolean;
  /** Lens budget overflow: "throw" (dev/test, default) or "warn" (prod). */
  lensBudget?: "throw" | "warn";
  initialState?: MorphUIState;
  /** Text for `current_workspace` in the core lens. Default: "<id>: <tree description>". */
  describeWorkspace?: (id: string) => string;
}

export interface ResolveOptions {
  trigger?: Trigger;
  signal?: AbortSignal;
  /** Time the caller spent computing facts, recorded in the trace. */
  factsMs?: number;
}

export interface ResolveResult {
  state: MorphUIState;
  diff: UIDiffOp[];
  outcome: GateOutcome;
  trace: DecisionTrace;
}

export interface LocalResult {
  state: MorphUIState;
  diff: UIDiffOp[];
}

export interface MorphUpdate {
  state: MorphUIState | null;
  trace: DecisionTrace | null;
}

export type MorphListener = (update: MorphUpdate) => void;

export interface Morph {
  resolve(ctx: MorphContext, opts?: ResolveOptions): Promise<ResolveResult>;
  /** Recompose a runner-up from stored answers. No provider call. */
  override(traceId: string, leafId: string, via?: "alternate" | "undo" | "clarify"): LocalResult;
  /** Resolve a pending confirm. No provider call. */
  confirm(traceId: string, accepted: boolean): LocalResult;
  /** Restore the previous workspace. No provider call. Returns null when there is nothing to undo. */
  undo(): LocalResult | null;
  canUndo(): boolean;
  emit(event: MorphEvent): void;
  subscribe(listener: MorphListener): () => void;
  getState(): MorphUIState | null;
  setState(state: MorphUIState): void;
  /** Compose a leaf directly (e.g. the initial overview). No provider call. */
  composeLeaf(
    leafId: string,
    ctx: MorphContext,
    opts?: { filter?: string | null; answers?: Answers; traceId?: string },
  ): MorphUIState;
  getTrace(id: string): DecisionTrace | undefined;
  readonly sink: TraceSink;
  readonly registry: CapabilityRegistry;
  readonly config: GateConfig;
}

interface TurnRecord {
  ctx: MorphContext;
  answers: Answers;
  candidates: Candidate[];
  pendingTarget: Candidate | null;
  filter: string | null;
}

const MAX_RECORDS = 200;
const MAX_HISTORY = 20;

let fallbackCounter = 0;
const defaultIdGen = () => `t_${Date.now().toString(36)}_${(fallbackCounter++).toString(36)}`;

export function createMorph(cfg: MorphConfig): Morph {
  const clock = cfg.clock ?? Date.now;
  const idGen = cfg.idGen ?? defaultIdGen;
  const policy = cfg.policy ?? defaultPolicy;
  const lenses = cfg.lenses ?? defaultLenses;
  const gateConfig = resolveGateConfig(cfg.gate);
  const cache = cfg.cache === false ? undefined : (cfg.cache ?? new LruCache({ clock }));
  const sink = cfg.traceSink ?? new RingBufferSink({ clock });
  const staticSpecs = validateSpecs(cfg.specs);
  validateTree(cfg.tree);
  const templates = new Map(cfg.templates.map((t) => [t.leafId, t]));
  for (const leaf of leaves(cfg.tree)) {
    if (!templates.has(leaf.id)) throw new Error(`No template for leaf "${leaf.id}".`);
  }
  const describeWorkspace =
    cfg.describeWorkspace ??
    ((id: string) => {
      const node = findNode(cfg.tree, id);
      return node ? `${id}: ${node.description}` : id;
    });

  const records = new Map<string, TurnRecord>();
  const listeners = new Set<MorphListener>();
  const history: MorphUIState[] = [];
  let state: MorphUIState | null = cfg.initialState ?? null;
  let lastTrace: DecisionTrace | null = null;

  const notify = () => {
    for (const l of listeners) l({ state, trace: lastTrace });
  };

  const remember = (id: string, rec: TurnRecord) => {
    records.set(id, rec);
    while (records.size > MAX_RECORDS) {
      const oldest = records.keys().next().value;
      if (oldest === undefined) break;
      records.delete(oldest);
    }
  };

  const setCurrent = (next: MorphUIState, pushHistory: boolean) => {
    if (
      pushHistory &&
      state &&
      (state.workspaceId !== next.workspaceId || state.filter !== next.filter)
    ) {
      history.push(state);
      while (history.length > MAX_HISTORY) history.shift();
    }
    state = next;
  };

  const title = (leafId: string, ctx: MorphContext, answers: Answers) =>
    templates.get(leafId)?.title(ctx.facts, answers) ?? leafId;

  const alternatesFor = (
    leafId: string,
    candidates: Candidate[],
    ctx: MorphContext,
    answers: Answers,
  ) =>
    candidates
      .filter((c) => c.leafId !== leafId)
      .slice(0, 2)
      .map((c) => ({ leafId: c.leafId, title: title(c.leafId, ctx, answers), score: c.score }));

  const composeFor = (
    leafId: string,
    ctx: MorphContext,
    answers: Answers,
    filter: string | null,
    traceId: string,
    candidates: Candidate[],
  ): ComposeResult => {
    const template = templates.get(leafId);
    if (!template) throw new Error(`No template for leaf "${leafId}".`);
    return compose({
      template,
      facts: ctx.facts,
      answers,
      ctx,
      registry: cfg.registry,
      policy,
      traceId,
      filter,
      alternates: alternatesFor(leafId, candidates, ctx, answers),
    });
  };

  /** Prune leaves the app cannot render or the user may not see (SPEC §8.2). */
  const pruneFor = (ctx: MorphContext) => {
    const policyLog: { subject: string; decision: PolicyDecision }[] = [];
    const risk = new Map<string, RiskLevel>();
    const filters = new Map<string, string[]>();
    const result = pruneTree(cfg.tree, (leafId) => {
      const template = templates.get(leafId) as WorkspaceTemplate;
      filters.set(leafId, template.supportsFilters);
      const missing = template.requiresData.filter((d) => !hasCapability(ctx.facts, d));
      if (missing.length) return `missing data: ${missing.join(", ")}`;
      const built = template.build({
        facts: ctx.facts,
        answers: {},
        ctx,
        density: 2,
        filter: null,
      });
      const allowedRisks: RiskLevel[] = [];
      for (const c of built) {
        const cap = cfg.registry.get(c.type);
        if (!cap) {
          if (template.required.includes(c.id)) return `unknown capability "${c.type}"`;
          continue;
        }
        const decision = policy.canRender(cap, ctx);
        if (!decision.allowed) {
          policyLog.push({ subject: `${leafId}/${c.id}`, decision });
          if (template.required.includes(c.id)) return `policy: ${decision.reason}`;
          continue;
        }
        allowedRisks.push(cap.risk);
      }
      risk.set(leafId, maxRisk(allowedRisks));
      return null;
    });
    return { ...result, policyLog, risk, filters };
  };

  /** Max risk of the capabilities the template renders with these answers (never below the pruning estimate). */
  const riskWithAnswers = (
    leafId: string,
    ctx: MorphContext,
    answers: Answers,
    floor: RiskLevel,
  ): RiskLevel => {
    const template = templates.get(leafId);
    if (!template) return floor;
    const built = template.build({
      facts: ctx.facts,
      answers,
      ctx,
      density: densityFrom(answers),
      filter: null,
    });
    const risks: RiskLevel[] = [floor];
    for (const c of built) {
      const cap = cfg.registry.get(c.type);
      if (cap && policy.canRender(cap, ctx).allowed) risks.push(cap.risk);
    }
    return maxRisk(risks);
  };

  const pendingOptions = (cs: Candidate[], ctx: MorphContext, answers: Answers): PendingOption[] =>
    cs.map((c) => ({ leafId: c.leafId, title: title(c.leafId, ctx, answers) }));

  const resolve = async (ctx: MorphContext, opts: ResolveOptions = {}): Promise<ResolveResult> => {
    const t0 = clock();
    const trigger = opts.trigger ?? "intent";
    const traceId = idGen();
    const prev = state;
    const pruning = pruneFor(ctx);
    const policyLog = [...pruning.policyLog];
    const tree = pruning.tree;

    const trace: DecisionTrace = {
      id: traceId,
      at: t0,
      trigger,
      intent: ctx.intent.raw,
      lensStates: {},
      batches: [],
      answers: {},
      pruned: pruning.pruned,
      beam: { candidates: [], separation: 0 },
      gate: { outcome: { kind: "stay", reason: "pending" }, reason: "", config: gateConfig },
      policy: policyLog,
      diff: [],
      narrative: [],
      timings: { factsMs: opts.factsMs ?? 0, decideMs: 0, resolveMs: 0, composeMs: 0, totalMs: 0 },
    };

    const keepCurrent = (pending: MorphUIState["pending"]): MorphUIState | null =>
      prev ? { ...prev, pending, traceId } : null;

    let answers: Answers = {};
    let candidates: Candidate[] = [];
    let separationValue = 0;
    const batchLog: BatchLogEntry[] = [];
    const tDecide = clock();
    try {
      if (!tree) throw new Error("Every workspace was pruned.");
      const nodes = decisionNodes(tree);
      const full = nodes.length <= gateConfig.fullTreeMaxNodes;
      const treeSpecs = full ? validateSpecs(buildTreeQuestions(tree, nodes)) : [];
      const planOpts = {
        lenses,
        deps: { describeWorkspace },
        onBudgetExceeded: cfg.lensBudget ?? "throw",
      } as const;
      const p = plan([...staticSpecs, ...treeSpecs], ctx, planOpts);
      for (const [id, info] of Object.entries(p.lensStates)) {
        trace.lensStates[id] = cfg.traceFull
          ? info
          : { hash: info.hash, tokensEst: info.tokensEst };
      }
      const execOpts = {
        clock,
        ...(cache ? { cache } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      };
      const res = await execute(p.stages, cfg.provider, execOpts);
      answers = res.answers;
      batchLog.push(...res.batchLog);
      trace.timings.decideMs = clock() - tDecide;
      const tResolve = clock();
      if (full) {
        const beam = beamSearch(tree, answers, gateConfig.beamWidth);
        candidates = beam.candidates;
        separationValue = beam.separation;
      } else {
        const beam = await beamSearchLevelwise(
          tree,
          async (ask) => {
            const specs = validateSpecs(buildTreeQuestions(tree, ask));
            const r = await execute(plan(specs, ctx, planOpts).stages, cfg.provider, execOpts);
            batchLog.push(...r.batchLog);
            return r.answers;
          },
          gateConfig.beamWidth,
        );
        Object.assign(answers, beam.answers);
        candidates = beam.candidates;
        separationValue = beam.separation;
      }
      trace.timings.resolveMs = clock() - tResolve;
    } catch (err) {
      // I11: a provider failure never blanks the workspace. Keep the current UI.
      trace.batches = batchLog;
      trace.error = errorMessage(err);
      trace.timings.decideMs = clock() - tDecide;
      const reason = `Decision failed; keeping the current workspace (${trace.error}).`;
      const outcome: GateOutcome = { kind: "stay", reason: "provider failure" };
      const next = prev ? { ...prev, pending: null, traceId } : null;
      return finish(trace, prev, next, outcome, reason, t0);
    }
    trace.batches = batchLog;
    trace.answers = answers;
    trace.beam = { candidates, separation: separationValue };

    const treeCalibrated = Object.entries(answers)
      .filter(([id]) => id.startsWith("ws."))
      .every(([, a]) => a.meta.calibrated);
    const currentId = ctx.ui.workspaceId;
    const gateInputBase = {
      answers,
      config: gateConfig,
      trigger,
      now: ctx.now,
      current: {
        workspaceId: currentId,
        lastMorphAt: ctx.ui.lastMorphAt,
        score: currentId && tree ? leafScore(tree, answers, currentId) : 0,
      },
      supportsFilters: (leafId: string) =>
        pruning.filters.get(leafId) ?? templates.get(leafId)?.supportsFilters ?? [],
      riskOf: (leafId: string) =>
        riskWithAnswers(leafId, ctx, answers, pruning.risk.get(leafId) ?? "low"),
      treeCalibrated,
    };

    const tCompose = clock();
    let remaining = candidates;
    let gate: GateResult = runGate({ ...gateInputBase, candidates: remaining });
    let next: MorphUIState | null = null;
    let reason = gate.reason;
    for (;;) {
      const o = gate.outcome;
      if (o.kind === "auto" || o.kind === "refine") {
        const leafId = o.kind === "auto" ? o.target.leafId : (currentId as string);
        const filter = o.kind === "refine" ? o.filter : gate.filter;
        const c = composeFor(leafId, ctx, answers, filter, traceId, candidates);
        policyLog.push(...c.policy);
        if (c.invalid) {
          // A required component was denied: drop this candidate and re-run the gate (SPEC §10).
          remaining = remaining.filter((x) => x.leafId !== leafId);
          if (o.kind === "refine") {
            next = prev ? { ...prev, pending: null, traceId } : null;
            gate = { ...gate, outcome: { kind: "stay", reason: "refinement denied by policy" } };
            reason = `Refinement of "${leafId}" lost a required component to policy.`;
            break;
          }
          gate = runGate({ ...gateInputBase, candidates: remaining });
          reason = `${reason} → "${leafId}" invalid after policy; re-gated: ${gate.reason}`;
          continue;
        }
        if (c.validation.length) trace.validation = c.validation;
        next = c.state;
        break;
      }
      if (o.kind === "confirm") {
        next = keepCurrent({ kind: "confirm", options: pendingOptions([o.target], ctx, answers) });
      } else if (o.kind === "alternates") {
        next = keepCurrent({
          kind: "alternates",
          options: pendingOptions(o.options, ctx, answers),
        });
      } else if (o.kind === "clarify") {
        const pending: NonNullable<MorphUIState["pending"]> = {
          kind: "clarify",
          options: pendingOptions(o.options, ctx, answers),
        };
        if (o.filters) pending.filters = o.filters;
        next = keepCurrent(pending);
      } else {
        next = keepCurrent(null);
      }
      break;
    }
    // No current workspace yet (first turn without an initial state): show the top candidate.
    if (!next && candidates[0]) {
      next = composeFor(candidates[0].leafId, ctx, answers, null, traceId, candidates).state;
    }
    trace.timings.composeMs = clock() - tCompose;
    const pendingTarget = gate.outcome.kind === "confirm" ? gate.outcome.target : null;
    remember(traceId, { ctx, answers, candidates, pendingTarget, filter: gate.filter });
    const o = gate.outcome;
    const target = o.kind === "auto" || o.kind === "confirm" ? o.target : null;
    const step8 = target
      ? {
          risk: gateInputBase.riskOf(target.leafId),
          confidence: treeCalibrated
            ? pathConfidence(target)
            : Math.min(pathConfidence(target), gateConfig.uncalibratedCap),
        }
      : undefined;
    return finish(trace, prev, next, gate.outcome, reason, t0, step8);
  };

  const finish = (
    trace: DecisionTrace,
    prev: MorphUIState | null,
    next: MorphUIState | null,
    outcome: GateOutcome,
    reason: string,
    t0: number,
    step8?: { risk: RiskLevel; confidence: number },
  ): ResolveResult => {
    const finalState = next ?? prev;
    if (!finalState)
      throw new Error("MORPH has no workspace to show. Pass initialState to createMorph().");
    const d = diff(prev, finalState);
    const moved = outcome.kind === "auto" || outcome.kind === "refine";
    setCurrent(finalState, moved);
    trace.gate = { outcome, reason, config: gateConfig };
    if (step8) {
      trace.gate.risk = step8.risk;
      trace.gate.confidence = step8.confidence;
    }
    trace.diff = d;
    trace.result = { workspaceId: finalState.workspaceId, filter: finalState.filter };
    trace.timings.totalMs = clock() - t0;
    lastTrace = trace;
    sink.write(trace);
    notify();
    return { state: finalState, diff: d, outcome, trace };
  };

  const local = (next: MorphUIState, event: MorphEvent | null): LocalResult => {
    const prev = state;
    const d = diff(prev, next);
    setCurrent(next, true);
    if (event) sink.event(event);
    const t = lastTrace;
    if (t && t.id === next.traceId) {
      // Keep the trace's diff/result in sync with what the user now sees.
      t.result = { workspaceId: next.workspaceId, filter: next.filter };
      sink.write(t);
    }
    notify();
    return { state: next, diff: d };
  };

  const override = (
    traceId: string,
    leafId: string,
    via: "alternate" | "undo" | "clarify" = "alternate",
  ): LocalResult => {
    const rec = records.get(traceId);
    if (!rec) throw new Error(`Unknown trace "${traceId}".`);
    if (!templates.has(leafId)) throw new Error(`Unknown workspace "${leafId}".`);
    const from = state?.workspaceId ?? "none";
    const filter =
      rec.filter && templates.get(leafId)?.supportsFilters.includes(rec.filter) ? rec.filter : null;
    const c = composeFor(leafId, rec.ctx, rec.answers, filter, traceId, rec.candidates);
    return local(c.state, { type: "override", traceId, from, to: leafId, via });
  };

  const confirm = (traceId: string, accepted: boolean): LocalResult => {
    const rec = records.get(traceId);
    sink.event({ type: "confirm", traceId, accepted });
    if (!rec || !accepted || !rec.pendingTarget) {
      if (!state) throw new Error("Nothing to confirm.");
      if (rec) rec.pendingTarget = null;
      return local({ ...state, pending: null }, null);
    }
    const target = rec.pendingTarget;
    rec.pendingTarget = null;
    const c = composeFor(target.leafId, rec.ctx, rec.answers, rec.filter, traceId, rec.candidates);
    return local(c.state, null);
  };

  const undo = (): LocalResult | null => {
    const previous = history.pop();
    if (!previous || !state) return null;
    const from = state.workspaceId;
    const prevState = state;
    state = { ...previous, pending: null };
    const d = diff(prevState, state);
    sink.event({
      type: "override",
      traceId: prevState.traceId,
      from,
      to: previous.workspaceId,
      via: "undo",
    });
    notify();
    return { state, diff: d };
  };

  return {
    resolve,
    override,
    confirm,
    undo,
    canUndo: () => history.length > 0,
    emit: (e) => {
      sink.event(e);
      notify();
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getState: () => state,
    setState: (s) => {
      state = s;
      notify();
    },
    composeLeaf: (leafId, ctx, opts = {}) => {
      const answers = opts.answers ?? {};
      const template = templates.get(leafId);
      if (!template) throw new Error(`Unknown workspace "${leafId}".`);
      return compose({
        template,
        facts: ctx.facts,
        answers,
        ctx,
        registry: cfg.registry,
        policy,
        traceId: opts.traceId ?? "initial",
        filter: opts.filter ?? null,
        density: densityFrom(answers),
      }).state;
    },
    getTrace: (id) =>
      sink instanceof RingBufferSink ? sink.get(id) : lastTrace?.id === id ? lastTrace : undefined,
    sink,
    registry: cfg.registry,
    config: gateConfig,
  };
}
