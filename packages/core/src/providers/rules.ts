import type { JsonValue } from "../context/types";
import type { Answers } from "../decisions/answer";
import { normalizeAnswer } from "../decisions/normalize";
import type { DecisionSpec } from "../decisions/spec";
import type { DecisionBatch, DecisionProvider } from "./types";

/**
 * A rule maps lens state to a distribution:
 * - choice: weights per option label (missing labels get 0; all-zero → uniform)
 * - score: weights per level index
 * - noul: P(yes) in [0, 1]
 */
export type Rule = (state: JsonValue, spec: DecisionSpec) => Record<string, number> | number;

export interface RulesProviderOptions {
  rules: Record<string, Rule>;
  /** Weight added to every option so no probability is exactly zero. Default 0.02. */
  smoothing?: number;
  name?: string;
}

/** Deterministic keyword/regex rules per spec ID. Uncalibrated; works offline. */
export class RulesProvider implements DecisionProvider {
  readonly name: string;
  readonly calibrated = false;
  readonly #rules: Record<string, Rule>;
  readonly #smoothing: number;

  constructor(opts: RulesProviderOptions) {
    this.#rules = opts.rules;
    this.#smoothing = opts.smoothing ?? 0.02;
    this.name = opts.name ?? "rules";
  }

  has(specId: string): boolean {
    return specId in this.#rules;
  }

  async evaluate(batch: DecisionBatch): Promise<Answers> {
    const out: Answers = {};
    for (const spec of batch.specs) out[spec.id] = this.answer(spec, batch.state);
    return out;
  }

  answer(spec: DecisionSpec, state: JsonValue) {
    const meta = {
      provider: this.name,
      model: null,
      calibrated: false,
      latencyMs: 0,
      cached: false,
    };
    const rule = this.#rules[spec.id];
    const result = rule ? rule(state, spec) : undefined;
    if (spec.kind === "noul") {
      const p = typeof result === "number" ? clamp01(result) : 0.5;
      return normalizeAnswer(spec, { kind: "noul", p }, meta);
    }
    const keys =
      spec.kind === "choice" ? Object.keys(spec.options) : spec.levels.map((_, i) => String(i));
    const weights = typeof result === "object" ? result : {};
    const raw = keys.map((k) => Math.max(0, weights[k] ?? 0));
    const total = raw.reduce((a, b) => a + b, 0);
    const base = total > 0 ? raw.map((w) => w / total) : keys.map(() => 1 / keys.length);
    const smoothed = base.map((p) => p + this.#smoothing);
    const z = smoothed.reduce((a, b) => a + b, 0);
    const probabilities: Record<string, number> = {};
    keys.forEach((k, i) => {
      probabilities[k] = (smoothed[i] as number) / z;
    });
    if (spec.kind === "choice")
      return normalizeAnswer(spec, { kind: "choice", probabilities }, meta);
    return normalizeAnswer(spec, { kind: "score", probabilities }, meta);
  }
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0.5;
}

/** Read a string field from lens state (empty string when absent). */
export function stateText(state: JsonValue, field: string): string {
  if (state && typeof state === "object" && !Array.isArray(state)) {
    const v = state[field];
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v.filter((x) => typeof x === "string").join(" \n ");
  }
  return "";
}

export interface KeywordPattern {
  /** Label (choice) or level index as string (score). */
  label: string;
  pattern: RegExp;
  weight?: number;
}

/**
 * Build a rule that scores labels by regex matches against a state field (default `intent`).
 * `otherwise` receives the weight when nothing matches.
 */
export function keywordRule(
  patterns: KeywordPattern[],
  opts: { field?: string; otherwise?: string; otherwiseWeight?: number } = {},
): Rule {
  return (state) => {
    const text = stateText(state, opts.field ?? "intent");
    const weights: Record<string, number> = {};
    let matched = false;
    for (const { label, pattern, weight } of patterns) {
      if (pattern.test(text)) {
        weights[label] = (weights[label] ?? 0) + (weight ?? 1);
        matched = true;
      }
    }
    if (!matched && opts.otherwise) weights[opts.otherwise] = opts.otherwiseWeight ?? 1;
    return weights;
  };
}
