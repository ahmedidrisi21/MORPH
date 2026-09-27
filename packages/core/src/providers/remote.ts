import type { Answers } from "../decisions/answer";
import { ProviderError, ProviderRateLimitError } from "./errors";
import type { DecisionBatch, EvaluationReport, ProviderAttempt, ReportingProvider } from "./types";

/** Minimal fetch shape so core needs no DOM types. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface RemoteProviderOptions {
  url: string;
  fetchImpl?: FetchLike;
  clock?: () => number;
}

export interface DecideResponse {
  answers: Answers[];
  provider: string;
  model: string | null;
  fallbacks: string[];
  attempts?: ProviderAttempt[];
}

/**
 * Browser provider: POST { batches } to the app's decide route (Appendix B).
 * Only lens states and specs leave the browser; keys stay on the server (I8).
 */
export class RemoteProvider implements ReportingProvider {
  readonly name = "remote";
  readonly calibrated: boolean;
  readonly #url: string;
  readonly #fetch: FetchLike;
  readonly #clock: () => number;

  constructor(opts: RemoteProviderOptions & { calibrated?: boolean }) {
    this.#url = opts.url;
    const f = opts.fetchImpl ?? (globalThis as { fetch?: FetchLike }).fetch;
    if (!f) throw new Error("RemoteProvider needs fetchImpl when global fetch is unavailable.");
    this.#fetch = f;
    this.#clock = opts.clock ?? Date.now;
    this.calibrated = opts.calibrated ?? true;
  }

  async evaluate(batch: DecisionBatch): Promise<Answers> {
    return (await this.evaluateWithReport(batch)).answers;
  }

  async evaluateWithReport(batch: DecisionBatch): Promise<EvaluationReport> {
    const start = this.#clock();
    const init: Parameters<FetchLike>[1] = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ batches: [{ state: batch.state, specs: batch.specs }] }),
    };
    if (batch.signal) init.signal = batch.signal;
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.#fetch(this.#url, init);
    } catch (err) {
      throw new ProviderError(this.name, "network error calling decide route", { cause: err });
    }
    const body = (await res.json().catch(() => null)) as
      | (Partial<DecideResponse> & { error?: { code?: string; message?: string } })
      | null;
    if (!res.ok || !body || !Array.isArray(body.answers)) {
      const message = body?.error?.message ?? `decide route returned ${res.status}`;
      if (res.status === 429) throw new ProviderRateLimitError(this.name, message);
      throw new ProviderError(this.name, message);
    }
    const answers = body.answers[0];
    if (!answers) throw new ProviderError(this.name, "decide route returned no answers");
    const attempts: ProviderAttempt[] = body.attempts?.length
      ? body.attempts
      : [
          {
            provider: body.provider ?? this.name,
            model: body.model ?? null,
            latencyMs: this.#clock() - start,
            ok: true,
          },
        ];
    return { answers, attempts };
  }
}
