// Server only. Never import this subpath from browser code (I8).
import {
  APIConnectionError,
  APIError,
  APIUserAbortError,
  type EntryType,
  type Fetch,
  noul,
  type Question,
  RateLimitError,
  choice as sdkChoice,
  score as sdkScore,
  TypeSafeClient,
} from "@typesafe-ai/sdk";
import type { JsonValue } from "../../context/types";
import type { Answers } from "../../decisions/answer";
import { normalizeAnswer, type RawAnswer } from "../../decisions/normalize";
import type { DecisionSpec } from "../../decisions/spec";
import {
  ProviderError,
  ProviderRateLimitError,
  ProviderResponseError,
  ProviderTimeoutError,
} from "../errors";
import type { DecisionBatch, EvaluationReport, ReportingProvider } from "../types";

export const DEFAULT_JEV_MODEL = "jev-1.13.0";
export const JEV_ATTEMPT_TIMEOUT_MS = 2500;
export const JEV_MAX_RETRIES = 1;

export interface JevProviderOptions {
  apiKey?: string;
  /** Pinned, versioned model ID. Never an alias (I10). */
  model?: string;
  baseURL?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Injectable fetch (tests). */
  fetch?: Fetch;
  clock?: () => number;
}

/** Reject unpinned aliases such as "<family>-latest" (I10). */
export function assertPinnedModel(model: string): string {
  if (!/^[a-z0-9-]+-\d+\.\d+\.\d+$/.test(model)) {
    throw new Error(
      `MORPH_JEV_MODEL must be a pinned, versioned model ID such as "${DEFAULT_JEV_MODEL}" (got "${model}").`,
    );
  }
  return model;
}

export function toQuestion(s: DecisionSpec): Question {
  switch (s.kind) {
    case "choice":
      return sdkChoice(s.instructions, s.options);
    case "score":
      return sdkScore(s.instructions, s.levels);
    case "noul":
      return noul(s.instructions, s.criteria ?? null);
  }
}

/** The SDK accepts text, objects, arrays or null as state; wrap other primitives as text. */
export function toEntry(state: JsonValue): EntryType {
  if (state === null || typeof state === "string" || typeof state === "object")
    return state as EntryType;
  return JSON.stringify(state);
}

/** Wire keys q0..qN (spec IDs contain dots). */
export function wireKeys(specs: DecisionSpec[]): [string, DecisionSpec][] {
  return specs.map((s, i) => [`q${i}`, s]);
}

interface WireAnswer {
  type: string;
  choice?: string;
  score?: number;
  noul?: number;
  confidence?: number;
  probabilities?: Record<string, number>;
}

export function fromWire(spec: DecisionSpec, a: WireAnswer): RawAnswer {
  if (a.type === "choice") {
    const raw: RawAnswer = { kind: "choice", probabilities: a.probabilities ?? {} };
    if (a.choice !== undefined) raw.value = a.choice;
    if (a.confidence !== undefined) raw.confidence = a.confidence;
    return raw;
  }
  if (a.type === "score") {
    const probabilities: Record<number, number> = {};
    for (const [k, v] of Object.entries(a.probabilities ?? {})) probabilities[Number(k)] = v;
    const raw: RawAnswer = { kind: "score", probabilities };
    if (a.score !== undefined) raw.expected = a.score;
    if (a.confidence !== undefined) raw.confidence = a.confidence;
    return raw;
  }
  if (a.type === "noul") return { kind: "noul", p: a.noul ?? Number.NaN };
  throw new ProviderResponseError("jev", `${spec.id}: unknown answer type "${a.type}"`);
}

/** Calibrated decisions from TypeSafe's Jev model: one `systemOne` call per batch (Appendix A). */
export class JevProvider implements ReportingProvider {
  readonly name = "jev";
  readonly calibrated = true;
  readonly model: string;
  readonly #client: TypeSafeClient;
  readonly #clock: () => number;

  constructor(opts: JevProviderOptions = {}) {
    if (typeof (globalThis as { window?: unknown }).window !== "undefined") {
      throw new Error("JevProvider is server-only. Use RemoteProvider in the browser.");
    }
    this.model = assertPinnedModel(opts.model ?? DEFAULT_JEV_MODEL);
    this.#clock = opts.clock ?? Date.now;
    this.#client = new TypeSafeClient({
      ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      defaultModel: this.model,
      timeout: opts.timeoutMs ?? JEV_ATTEMPT_TIMEOUT_MS,
      retry: { maxRetries: opts.maxRetries ?? JEV_MAX_RETRIES },
      logLevel: "off",
    });
  }

  async evaluate(batch: DecisionBatch): Promise<Answers> {
    return (await this.evaluateWithReport(batch)).answers;
  }

  async evaluateWithReport(batch: DecisionBatch): Promise<EvaluationReport> {
    const start = this.#clock();
    const keyed = wireKeys(batch.specs);
    const questions = Object.fromEntries(keyed.map(([k, s]) => [k, toQuestion(s)]));
    let res: {
      model: string;
      answers: Record<string, WireAnswer>;
      usage: { input_tokens: number };
    };
    let requestId: string | undefined;
    try {
      const promise = this.#client.systemOne(
        { state: toEntry(batch.state), questions },
        batch.signal ? { signal: batch.signal } : {},
      );
      const withResponse = await promise.withResponse();
      res = withResponse.data as unknown as typeof res;
      requestId = withResponse.requestId;
    } catch (err) {
      throw mapError(err);
    }
    const latencyMs = this.#clock() - start;
    const answers: Answers = {};
    for (const [k, spec] of keyed) {
      const wire = res.answers[k];
      if (!wire)
        throw new ProviderResponseError(
          this.name,
          `missing answer for ${spec.id}`,
          requestId ? { requestId } : {},
        );
      answers[spec.id] = normalizeAnswer(spec, fromWire(spec, wire), {
        provider: this.name,
        model: res.model,
        calibrated: true,
        latencyMs,
        cached: false,
      });
    }
    return {
      answers,
      attempts: [
        {
          provider: this.name,
          model: res.model,
          latencyMs,
          ok: true,
          inputTokens: res.usage.input_tokens,
          ...(requestId ? { requestId } : {}),
        },
      ],
    };
  }
}

export function mapError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof RateLimitError) {
    return new ProviderRateLimitError("jev", "rate limited", {
      cause: err,
      ...(err.requestId ? { requestId: err.requestId } : {}),
      ...(err.retryAfterMs !== undefined ? { retryAfterMs: err.retryAfterMs } : {}),
    });
  }
  if (err instanceof APIError) {
    return new ProviderError("jev", `API error ${err.status}`, {
      cause: err,
      ...(err.requestId ? { requestId: err.requestId } : {}),
    });
  }
  if (err instanceof APIUserAbortError)
    return new ProviderTimeoutError("jev", "aborted (time budget)", { cause: err });
  if (err instanceof APIConnectionError)
    return new ProviderError("jev", `connection error: ${err.message}`, { cause: err });
  return new ProviderError("jev", err instanceof Error ? err.message : String(err), { cause: err });
}
