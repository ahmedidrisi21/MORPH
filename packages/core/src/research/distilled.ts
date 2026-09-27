// Distilled per-app classifier (docs/backlog.md#distilled-classifier, ADR 0009). It learns to
// mimic the decisions a calibrated provider (Jev) already made, from the same lens states, so the
// app can answer offline or at the edge. It is uncalibrated and only answers specs it was trained
// on with the same options; anything else throws so a CompositeProvider falls back.
import type { JsonValue } from "../context/types";
import type { AnswerMeta, Answers } from "../decisions/answer";
import { normalizeAnswer } from "../decisions/normalize";
import type { DecisionSpec } from "../decisions/spec";
import { ProviderError } from "../providers/errors";
import type { DecisionBatch, DecisionProvider } from "../providers/types";
import { predictProba, type SoftmaxModel, type TrainOptions, trainSoftmax } from "./classifier";
import { DEFAULT_TEXT_DIMS, stateTextFeatures } from "./text";

export interface DistilledExample {
  state: JsonValue;
  answers: Answers;
}

export interface DistilledSpecModel {
  /** Option labels (choice), level indexes (score) or "yes"/"no" (noul) this model predicts. */
  labels: string[];
  model: SoftmaxModel;
  examples: number;
}

export interface DistilledModel {
  version: 1;
  dims: number;
  /** The provider/model the examples came from, e.g. "jev-1.13.0". */
  teacher: string;
  specs: Record<string, DistilledSpecModel>;
}

/** Output labels a spec can take, in a fixed order. */
export function specLabels(spec: DecisionSpec): string[] {
  if (spec.kind === "choice") return Object.keys(spec.options);
  if (spec.kind === "score") return spec.levels.map((_, i) => String(i));
  return ["no", "yes"];
}

function labelOf(spec: DecisionSpec, answers: Answers): { label: string; weight: number } | null {
  const a = answers[spec.id];
  if (!a || a.kind !== spec.kind) return null;
  if (a.kind === "choice") return { label: a.value, weight: a.confidence };
  if (a.kind === "score") {
    const probs = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]);
    const [top] = probs;
    return top ? { label: String(top[0]), weight: top[1] } : null;
  }
  return { label: a.p >= 0.5 ? "yes" : "no", weight: Math.max(a.p, 1 - a.p) };
}

/**
 * Trains one small text classifier per spec from teacher answers. Each example is weighted by
 * the teacher's confidence, so uncertain answers count less. Specs with fewer than `minExamples`
 * labelled examples are left out.
 */
export function trainDistilled(
  examples: DistilledExample[],
  specs: DecisionSpec[],
  opts: TrainOptions & { dims?: number; minExamples?: number; teacher?: string } = {},
): DistilledModel {
  const dims = opts.dims ?? DEFAULT_TEXT_DIMS;
  const minExamples = opts.minExamples ?? 20;
  const features = examples.map((e) => stateTextFeatures(e.state, dims));
  const out: DistilledModel = { version: 1, dims, teacher: opts.teacher ?? "unknown", specs: {} };
  for (const spec of specs) {
    const x: number[][] = [];
    const y: string[] = [];
    const w: number[] = [];
    examples.forEach((e, i) => {
      const l = labelOf(spec, e.answers);
      if (!l || !specLabels(spec).includes(l.label)) return;
      x.push(features[i] as number[]);
      y.push(l.label);
      w.push(l.weight);
    });
    if (x.length < minExamples) continue;
    const trainOpts: TrainOptions = { sampleWeights: w };
    if (opts.epochs !== undefined) trainOpts.epochs = opts.epochs;
    if (opts.learningRate !== undefined) trainOpts.learningRate = opts.learningRate;
    if (opts.l2 !== undefined) trainOpts.l2 = opts.l2;
    out.specs[spec.id] = {
      labels: specLabels(spec),
      model: trainSoftmax(x, y, trainOpts),
      examples: x.length,
    };
  }
  return out;
}

/** Offline provider over a `DistilledModel`. Uncalibrated, so the gate caps its confidence. */
export class DistilledProvider implements DecisionProvider {
  readonly name = "distilled";
  readonly calibrated = false;
  readonly #model: DistilledModel;
  /** Probability kept for labels the teacher never used, so no answer is exactly 0. */
  readonly #smoothing: number;

  constructor(model: DistilledModel, opts: { smoothing?: number } = {}) {
    if (model.version !== 1)
      throw new Error(`Unsupported distilled model version ${model.version}`);
    this.#model = model;
    this.#smoothing = opts.smoothing ?? 0.01;
  }

  covers(spec: DecisionSpec): boolean {
    const m = this.#model.specs[spec.id];
    const labels = specLabels(spec);
    return !!m && m.labels.length === labels.length && m.labels.every((l, i) => l === labels[i]);
  }

  async evaluate(batch: DecisionBatch): Promise<Answers> {
    const missing = batch.specs.filter((s) => !this.covers(s)).map((s) => s.id);
    if (missing.length) {
      throw new ProviderError(this.name, `No distilled model for ${missing.join(", ")}.`);
    }
    const x = stateTextFeatures(batch.state, this.#model.dims);
    const meta: AnswerMeta = {
      provider: this.name,
      model: `distilled(${this.#model.teacher})`,
      calibrated: false,
      latencyMs: 0,
      cached: false,
    };
    const out: Answers = {};
    for (const spec of batch.specs) {
      const m = this.#model.specs[spec.id] as DistilledSpecModel;
      const p = predictProba(m.model, x);
      const raw: Record<string, number> = {};
      for (const l of m.labels) {
        const k = m.model.labels.indexOf(l);
        raw[l] = (k >= 0 ? (p[k] as number) : 0) + this.#smoothing;
      }
      const sum = Object.values(raw).reduce((a, b) => a + b, 0);
      for (const l of m.labels) raw[l] = (raw[l] as number) / sum;
      if (spec.kind === "noul") {
        out[spec.id] = normalizeAnswer(spec, { kind: "noul", p: raw.yes as number }, meta);
      } else if (spec.kind === "choice") {
        out[spec.id] = normalizeAnswer(spec, { kind: "choice", probabilities: raw }, meta);
      } else {
        out[spec.id] = normalizeAnswer(spec, { kind: "score", probabilities: raw }, meta);
      }
    }
    return out;
  }
}
