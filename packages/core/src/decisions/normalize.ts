import { ProviderResponseError } from "../providers/errors";
import type { Answer, AnswerMeta } from "./answer";
import type { DecisionSpec } from "./spec";

export const PROBABILITY_TOLERANCE = 0.02;

function checkUnit(provider: string, specId: string, name: string, x: number): void {
  if (!Number.isFinite(x) || x < 0 || x > 1) {
    throw new ProviderResponseError(provider, `${specId}: ${name} ${x} is outside [0, 1]`);
  }
}

function normalizeDistribution(
  provider: string,
  specId: string,
  keys: string[],
  raw: Record<string, number>,
): Record<string, number> {
  const missing = keys.filter((k) => !(k in raw));
  if (missing.length) {
    throw new ProviderResponseError(
      provider,
      `${specId}: missing probabilities for ${missing.join(", ")}`,
    );
  }
  let sum = 0;
  for (const k of keys) {
    const p = raw[k] as number;
    checkUnit(provider, specId, `probability[${k}]`, p);
    sum += p;
  }
  if (Math.abs(sum - 1) > PROBABILITY_TOLERANCE) {
    throw new ProviderResponseError(
      provider,
      `${specId}: probabilities sum to ${sum.toFixed(4)}, not 1 ± ${PROBABILITY_TOLERANCE}`,
    );
  }
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = (raw[k] as number) / sum;
  return out;
}

export interface RawChoice {
  kind: "choice";
  value?: string;
  probabilities: Record<string, number>;
  confidence?: number;
}
export interface RawScore {
  kind: "score";
  expected?: number;
  probabilities: Record<string | number, number>;
  confidence?: number;
}
export interface RawNoul {
  kind: "noul";
  p: number;
}
export type RawAnswer = RawChoice | RawScore | RawNoul;

/**
 * Validate and normalize a provider answer against its spec (SPEC §7.2):
 * every key present, probabilities sum to 1 ± 0.02 (renormalized), confidence/p in [0, 1].
 */
export function normalizeAnswer(spec: DecisionSpec, raw: RawAnswer, meta: AnswerMeta): Answer {
  const provider = meta.provider;
  if (raw.kind !== spec.kind) {
    throw new ProviderResponseError(
      provider,
      `${spec.id}: expected a ${spec.kind} answer, got ${raw.kind}`,
    );
  }
  if (spec.kind === "choice" && raw.kind === "choice") {
    const keys = Object.keys(spec.options);
    const extra = Object.keys(raw.probabilities).filter((k) => !keys.includes(k));
    if (extra.length)
      throw new ProviderResponseError(provider, `${spec.id}: unknown options ${extra.join(", ")}`);
    const probabilities = normalizeDistribution(provider, spec.id, keys, raw.probabilities);
    const argmax = keys.reduce((a, b) =>
      (probabilities[b] as number) > (probabilities[a] as number) ? b : a,
    );
    const value = raw.value ?? argmax;
    if (!keys.includes(value))
      throw new ProviderResponseError(provider, `${spec.id}: unknown choice "${value}"`);
    const confidence = raw.confidence ?? (probabilities[value] as number);
    checkUnit(provider, spec.id, "confidence", confidence);
    return { kind: "choice", value, probabilities, confidence, meta };
  }
  if (spec.kind === "score" && raw.kind === "score") {
    const keys = spec.levels.map((_, i) => String(i));
    const byString: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw.probabilities)) byString[String(Number(k))] = v;
    const extra = Object.keys(byString).filter((k) => !keys.includes(k));
    if (extra.length)
      throw new ProviderResponseError(provider, `${spec.id}: unknown levels ${extra.join(", ")}`);
    const norm = normalizeDistribution(provider, spec.id, keys, byString);
    const probabilities: Record<number, number> = {};
    let expected = 0;
    let best = 0;
    for (const k of keys) {
      const p = norm[k] as number;
      probabilities[Number(k)] = p;
      expected += Number(k) * p;
      if (p > (probabilities[best] as number)) best = Number(k);
    }
    const exp = raw.expected ?? expected;
    if (!Number.isFinite(exp) || exp < 0 || exp > spec.levels.length - 1) {
      throw new ProviderResponseError(provider, `${spec.id}: expected score ${exp} out of range`);
    }
    const confidence = raw.confidence ?? (probabilities[best] as number);
    checkUnit(provider, spec.id, "confidence", confidence);
    return { kind: "score", expected: exp, probabilities, confidence, meta };
  }
  if (raw.kind === "noul") {
    checkUnit(provider, spec.id, "p", raw.p);
    return { kind: "noul", p: raw.p, meta };
  }
  /* c8 ignore next */
  throw new ProviderResponseError(provider, `${spec.id}: unsupported answer`);
}

/** Round a score's fractional expected value to the nearest level index. */
export function nearestLevel(expected: number, levels: number): number {
  return Math.min(levels - 1, Math.max(0, Math.round(expected)));
}
