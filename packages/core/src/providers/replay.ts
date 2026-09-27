import { canonicalJSON } from "../cache/canonical";
import { fnv1a64 } from "../cache/fnv";
import type { JsonValue } from "../context/types";
import type { Answer, Answers } from "../decisions/answer";
import type { DecisionSpec } from "../decisions/spec";
import { ReplayMissError } from "./errors";
import {
  type DecisionBatch,
  type EvaluationReport,
  evaluateReported,
  type ReportingProvider,
} from "./types";

export interface FixtureStore {
  get(key: string): Promise<FixtureRecord | undefined> | FixtureRecord | undefined;
  set(key: string, value: FixtureRecord): Promise<void> | void;
}

/** One recorded answer. Stored pretty-printed with sorted keys. */
export interface FixtureRecord {
  key: string;
  provider: string;
  model: string | null;
  specId: string;
  answer: Answer;
}

export function memoryFixtureStore(initial: Record<string, FixtureRecord> = {}): FixtureStore & {
  entries(): Record<string, FixtureRecord>;
} {
  const map = new Map(Object.entries(initial));
  return {
    get: (key) => map.get(key),
    set: (key, value) => {
      map.set(key, value);
    },
    entries: () => Object.fromEntries(map),
  };
}

/** fnv1a64(canonicalJSON({ provider, model, spec, state })) — one key per spec. */
export function replayKey(
  provider: string,
  model: string | null,
  spec: DecisionSpec,
  state: JsonValue,
): string {
  return fnv1a64(canonicalJSON({ provider, model, spec, state }));
}

export type ReplayMode = "replay" | "record" | "replay-or-record";

export interface ReplayProviderOptions {
  store: FixtureStore;
  mode: ReplayMode;
  /** Provider called in record modes. Required unless mode is "replay". */
  inner?: ReplayProviderInner;
  /** Identity used in fixture keys; must match between recording and replay. */
  key: { provider: string; model: string | null };
  clock?: () => number;
}

type ReplayProviderInner = Parameters<typeof evaluateReported>[0];

export class ReplayProvider implements ReportingProvider {
  readonly name: string;
  readonly calibrated: boolean;
  readonly #opts: ReplayProviderOptions;

  constructor(opts: ReplayProviderOptions) {
    if (opts.mode !== "replay" && !opts.inner) {
      throw new Error(`ReplayProvider mode "${opts.mode}" needs an inner provider.`);
    }
    this.#opts = opts;
    this.name = `replay(${opts.key.provider})`;
    this.calibrated = opts.inner?.calibrated ?? true;
  }

  async evaluate(batch: DecisionBatch): Promise<Answers> {
    return (await this.evaluateWithReport(batch)).answers;
  }

  async evaluateWithReport(batch: DecisionBatch): Promise<EvaluationReport> {
    const { store, mode, key } = this.#opts;
    const clock = this.#opts.clock ?? Date.now;
    const start = clock();
    const keys = new Map(
      batch.specs.map((s) => [s.id, replayKey(key.provider, key.model, s, batch.state)]),
    );
    const answers: Answers = {};
    const missing: DecisionSpec[] = [];
    if (mode !== "record") {
      for (const spec of batch.specs) {
        const rec = await store.get(keys.get(spec.id) as string);
        if (rec)
          answers[spec.id] = {
            ...rec.answer,
            meta: { ...rec.answer.meta, provider: this.name, latencyMs: 0 },
          };
        else missing.push(spec);
      }
    } else {
      missing.push(...batch.specs);
    }
    if (missing.length === 0) {
      const model = Object.values(answers)[0]?.meta.model ?? key.model;
      return {
        answers,
        attempts: [{ provider: this.name, model, latencyMs: clock() - start, ok: true }],
      };
    }
    if (mode === "replay" || !this.#opts.inner) {
      throw new ReplayMissError(missing.map((s) => keys.get(s.id) as string));
    }
    const sub: DecisionBatch = { state: batch.state, specs: missing };
    if (batch.signal) sub.signal = batch.signal;
    const report = await evaluateReported(this.#opts.inner, sub, clock);
    for (const spec of missing) {
      const answer = report.answers[spec.id];
      if (!answer) continue;
      answers[spec.id] = answer;
      const k = keys.get(spec.id) as string;
      await store.set(k, {
        key: k,
        provider: key.provider,
        model: answer.meta.model,
        specId: spec.id,
        answer,
      });
    }
    return { answers, attempts: report.attempts };
  }
}
