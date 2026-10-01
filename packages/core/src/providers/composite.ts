import type { Answers } from "../decisions/answer";
import { errorMessage, ProviderError, ProviderTimeoutError } from "./errors";
import {
  type DecisionBatch,
  type DecisionProvider,
  type EvaluationReport,
  evaluateReported,
  type ProviderAttempt,
  type ReportingProvider,
} from "./types";

export const DEFAULT_TOTAL_BUDGET_MS = 4000;

export interface CompositeProviderOptions {
  /** Total time budget for the whole chain (not per attempt). Default 4000 ms. */
  budgetMs?: number;
  name?: string;
  clock?: () => number;
}

/**
 * Ordered chain with a total time budget. The first provider to succeed wins; every
 * failure (throw or timeout) is recorded as an attempt so the trace shows the fallback.
 * The last provider in the chain gets whatever budget remains, but never less than zero:
 * when the budget is exhausted the chain moves on immediately.
 */
export class CompositeProvider implements ReportingProvider {
  readonly name: string;
  readonly calibrated: boolean;
  readonly #chain: DecisionProvider[];
  readonly #budget: number;
  readonly #clock: () => number;

  constructor(chain: DecisionProvider[], opts: CompositeProviderOptions = {}) {
    if (chain.length === 0) throw new Error("CompositeProvider needs at least one provider.");
    this.#chain = chain;
    this.#budget = opts.budgetMs ?? DEFAULT_TOTAL_BUDGET_MS;
    this.#clock = opts.clock ?? Date.now;
    this.name = opts.name ?? `composite(${chain.map((p) => p.name).join("→")})`;
    this.calibrated = chain[0]?.calibrated ?? false;
  }

  async evaluate(batch: DecisionBatch): Promise<Answers> {
    return (await this.evaluateWithReport(batch)).answers;
  }

  async evaluateWithReport(batch: DecisionBatch): Promise<EvaluationReport> {
    const deadline = this.#clock() + this.#budget;
    const attempts: ProviderAttempt[] = [];
    let lastError: unknown;
    for (const [i, provider] of this.#chain.entries()) {
      const isLast = i === this.#chain.length - 1;
      const remaining = deadline - this.#clock();
      if (remaining <= 0 && !isLast) {
        attempts.push({
          provider: provider.name,
          model: null,
          latencyMs: 0,
          ok: false,
          error: "skipped: budget exhausted",
        });
        continue;
      }
      const start = this.#clock();
      try {
        const report = await withBudget(
          provider,
          batch,
          isLast ? Math.max(remaining, 0) : remaining,
          this.#clock,
        );
        attempts.push(...report.attempts);
        return { answers: report.answers, attempts };
      } catch (err) {
        lastError = err;
        attempts.push({
          provider: provider.name,
          model: null,
          latencyMs: this.#clock() - start,
          ok: false,
          error: errorMessage(err),
          ...(err instanceof ProviderError && err.requestId ? { requestId: err.requestId } : {}),
        });
        if (batch.signal?.aborted) break;
      }
    }
    const error = new ProviderError(
      this.name,
      `All providers failed: ${attempts.map((a) => a.error).join("; ")}`,
      {
        cause: lastError,
      },
    );
    (error as ProviderError & { attempts?: ProviderAttempt[] }).attempts = attempts;
    throw error;
  }
}

/** Run one provider under `ms` of budget; the last provider in a chain runs unbounded when ms is 0. */
async function withBudget(
  provider: DecisionProvider,
  batch: DecisionBatch,
  ms: number,
  clock: () => number,
): Promise<EvaluationReport> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(batch.signal?.reason);
  batch.signal?.addEventListener("abort", onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sub: DecisionBatch = { state: batch.state, specs: batch.specs, signal: controller.signal };
  try {
    const work = evaluateReported(provider, sub, clock);
    if (ms <= 0) return await work;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new ProviderTimeoutError(provider.name, `timed out after ${ms} ms`);
        controller.abort(err);
        reject(err);
      }, ms);
    });
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    batch.signal?.removeEventListener("abort", onAbort);
  }
}
