import { canonicalJSON } from "../cache/canonical";
import { fnv1a64 } from "../cache/fnv";
import { type CacheStore, DEFAULT_CACHE_TTL_MS } from "../cache/lru";
import {
  estimateTokens,
  LENS_TOKEN_BUDGET,
  type Lens,
  LensBudgetError,
  type LensDeps,
  type LensId,
} from "../context/lens";
import type { JsonValue, MorphContext } from "../context/types";
import { errorMessage, ProviderError } from "../providers/errors";
import { type DecisionProvider, evaluateReported, type ProviderAttempt } from "../providers/types";
import type { Answers } from "./answer";
import type { DecisionSpec } from "./spec";

export interface PlannedBatch {
  lens: LensId;
  stateHash: string;
  state: JsonValue;
  specs: DecisionSpec[];
}

export interface Stage {
  index: number;
  batches: PlannedBatch[];
}

export interface LensStateInfo {
  hash: string;
  tokensEst: number;
  content: JsonValue;
}

export interface PlanOptions {
  lenses: Record<LensId, Lens>;
  deps: LensDeps;
  /** "throw" in dev/test (default), "warn" in production. */
  onBudgetExceeded?: "throw" | "warn";
  warn?: (message: string) => void;
}

export interface Plan {
  stages: Stage[];
  lensStates: Record<LensId, LensStateInfo>;
}

/** Topologically stage specs by dependsOn; group specs with identical lens-state hashes. */
export function plan(specs: DecisionSpec[], ctx: MorphContext, opts: PlanOptions): Plan {
  const lensStates: Record<LensId, LensStateInfo> = {};
  const stateFor = (lensId: LensId): LensStateInfo => {
    const cached = lensStates[lensId];
    if (cached) return cached;
    const lens = opts.lenses[lensId];
    if (!lens) throw new Error(`Unknown lens "${lensId}".`);
    const content = lens(ctx, opts.deps);
    const tokensEst = estimateTokens(content);
    if (tokensEst > LENS_TOKEN_BUDGET) {
      const err = new LensBudgetError(lensId, tokensEst);
      if ((opts.onBudgetExceeded ?? "throw") === "throw") throw err;
      (opts.warn ?? console.warn)(err.message);
    }
    const info = { hash: fnv1a64(canonicalJSON(content)), tokensEst, content };
    lensStates[lensId] = info;
    return info;
  };

  const depth = new Map<string, number>();
  const byId = new Map(specs.map((s) => [s.id, s]));
  const depthOf = (s: DecisionSpec, seen: Set<string> = new Set()): number => {
    const known = depth.get(s.id);
    if (known !== undefined) return known;
    if (seen.has(s.id)) throw new Error(`dependsOn cycle at ${s.id}`);
    seen.add(s.id);
    let d = 0;
    for (const dep of s.dependsOn ?? []) {
      const parent = byId.get(dep);
      if (parent) d = Math.max(d, depthOf(parent, seen) + 1);
    }
    depth.set(s.id, d);
    return d;
  };

  const stages: Stage[] = [];
  for (const spec of specs) {
    const d = depthOf(spec);
    while (stages.length <= d) stages.push({ index: stages.length, batches: [] });
    const stage = stages[d] as Stage;
    const info = stateFor(spec.lens);
    let batch = stage.batches.find((b) => b.stateHash === info.hash);
    if (!batch) {
      batch = { lens: spec.lens, stateHash: info.hash, state: info.content, specs: [] };
      stage.batches.push(batch);
    }
    batch.specs.push(spec);
  }
  return { stages, lensStates };
}

export interface BatchLogEntry {
  provider: string;
  model: string | null;
  specIds: string[];
  latencyMs: number;
  cached: string[];
  error?: string;
  fallbackFrom?: string;
  inputTokens?: number;
  requestId?: string;
}

export interface ExecuteOptions {
  cache?: CacheStore;
  cacheTtlMs?: number;
  signal?: AbortSignal;
  concurrency?: number;
  clock?: () => number;
}

export interface ExecuteResult {
  answers: Answers;
  batchLog: BatchLogEntry[];
  providerCalls: number;
}

export function cacheKey(provider: string, spec: DecisionSpec, stateHash: string): string {
  return fnv1a64(canonicalJSON({ provider, spec, stateHash }));
}

/** Run stages in order; batches in a stage run with a concurrency limit (default 4). */
export async function execute(
  stages: Stage[],
  provider: DecisionProvider,
  opts: ExecuteOptions = {},
): Promise<ExecuteResult> {
  const clock = opts.clock ?? Date.now;
  const answers: Answers = {};
  const batchLog: BatchLogEntry[] = [];
  let providerCalls = 0;

  for (const stage of stages) {
    const tasks = stage.batches.map((batch) => async () => {
      const cachedIds: string[] = [];
      const toAsk: DecisionSpec[] = [];
      for (const spec of batch.specs) {
        const hit = opts.cache
          ? await opts.cache.get(cacheKey(provider.name, spec, batch.stateHash))
          : undefined;
        if (hit) {
          answers[spec.id] = { ...hit, meta: { ...hit.meta, cached: true, latencyMs: 0 } };
          cachedIds.push(spec.id);
        } else {
          toAsk.push(spec);
        }
      }
      if (toAsk.length === 0) {
        batchLog.push({
          provider: provider.name,
          model: null,
          specIds: [],
          latencyMs: 0,
          cached: cachedIds,
        });
        return;
      }
      providerCalls++;
      const start = clock();
      try {
        const report = await evaluateReported(
          provider,
          opts.signal
            ? { state: batch.state, specs: toAsk, signal: opts.signal }
            : { state: batch.state, specs: toAsk },
          clock,
        );
        for (const spec of toAsk) {
          const a = report.answers[spec.id];
          if (!a) throw new ProviderError(provider.name, `no answer for ${spec.id}`);
          answers[spec.id] = a;
          if (opts.cache)
            await opts.cache.set(
              cacheKey(provider.name, spec, batch.stateHash),
              a,
              opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
            );
        }
        pushAttempts(batchLog, report.attempts, toAsk, cachedIds);
      } catch (err) {
        const attempts = (err as { attempts?: ProviderAttempt[] }).attempts ?? [];
        pushAttempts(batchLog, attempts, toAsk, cachedIds);
        batchLog.push({
          provider: provider.name,
          model: null,
          specIds: toAsk.map((s) => s.id),
          latencyMs: clock() - start,
          cached: cachedIds,
          error: errorMessage(err),
        });
        throw err;
      }
    });
    await runLimited(tasks, opts.concurrency ?? 4);
  }
  return { answers, batchLog, providerCalls };
}

function pushAttempts(
  log: BatchLogEntry[],
  attempts: ProviderAttempt[],
  specs: DecisionSpec[],
  cached: string[],
): void {
  let previousFailure: string | undefined;
  for (const a of attempts) {
    const entry: BatchLogEntry = {
      provider: a.provider,
      model: a.model,
      specIds: specs.map((s) => s.id),
      latencyMs: a.latencyMs,
      cached,
    };
    if (a.error) entry.error = a.error;
    if (previousFailure) entry.fallbackFrom = previousFailure;
    if (a.inputTokens !== undefined) entry.inputTokens = a.inputTokens;
    if (a.requestId) entry.requestId = a.requestId;
    log.push(entry);
    previousFailure = a.ok ? undefined : a.provider;
  }
}

async function runLimited(tasks: (() => Promise<void>)[], limit: number): Promise<void> {
  let next = 0;
  let failure: unknown;
  const worker = async () => {
    while (next < tasks.length && failure === undefined) {
      const task = tasks[next++] as () => Promise<void>;
      try {
        await task();
      } catch (err) {
        failure ??= err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  if (failure !== undefined) throw failure;
}
