import { pathConfidence } from "../resolver/beam";
import type { DecisionTrace, TimedEvent } from "./types";

export const UNWANTED_MORPH_WINDOW_MS = 10_000;

const ratio = (n: number, d: number) => (d === 0 ? 0 : n / d);

/** Overrides (alternate, undo, clarify picks) per trace. */
export function overrideRate(traces: DecisionTrace[], events: TimedEvent[]): number {
  return ratio(events.filter((e) => e.type === "override").length, traces.length);
}

function overriddenSoon(t: DecisionTrace, events: TimedEvent[], windowMs: number): boolean {
  return events.some(
    (e) => e.type === "override" && e.traceId === t.id && e.at >= t.at && e.at - t.at <= windowMs,
  );
}

/** Share of `auto` morphs followed by an override or undo within 10 s. */
export function unwantedMorphRate(
  traces: DecisionTrace[],
  events: TimedEvent[],
  windowMs = UNWANTED_MORPH_WINDOW_MS,
): number {
  const autos = traces.filter((t) => t.gate.outcome.kind === "auto");
  return ratio(autos.filter((t) => overriddenSoon(t, events, windowMs)).length, autos.length);
}

export function clarifyRate(traces: DecisionTrace[]): number {
  return ratio(traces.filter((t) => t.gate.outcome.kind === "clarify").length, traces.length);
}

/** Share of traces where any batch fell back from a failed provider. */
export function fallbackRate(traces: DecisionTrace[]): number {
  return ratio(
    traces.filter((t) =>
      t.batches.some((b) => b.fallbackFrom !== undefined || b.error !== undefined),
    ).length,
    traces.length,
  );
}

export interface CalibrationRow {
  /** Lower bound of a 0.1-wide confidence bucket. */
  bucket: number;
  count: number;
  /** Share of outcomes not overridden. */
  accepted: number;
}

/** Confidence bucket (0.1 wide) vs. share of auto/confirm outcomes not overridden. */
export function calibrationTable(
  traces: DecisionTrace[],
  events: TimedEvent[],
  windowMs = UNWANTED_MORPH_WINDOW_MS,
): CalibrationRow[] {
  const rows = new Map<number, { count: number; ok: number }>();
  for (const t of traces) {
    const o = t.gate.outcome;
    if (o.kind !== "auto" && o.kind !== "confirm") continue;
    const conf = pathConfidence(o.target);
    const bucket = Math.min(9, Math.floor(conf * 10)) / 10;
    const row = rows.get(bucket) ?? { count: 0, ok: 0 };
    row.count++;
    if (!overriddenSoon(t, events, windowMs)) row.ok++;
    rows.set(bucket, row);
  }
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, r]) => ({ bucket, count: r.count, accepted: ratio(r.ok, r.count) }));
}

/** Nearest-rank percentile. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] as number;
}

export interface NarrativeSummary {
  /** Slots the narrative tier handled across the traces. */
  slots: number;
  /** Share of slots that showed verified model claims instead of the fact sentences. */
  aiShare: number;
  claimsIn: number;
  claimsKept: number;
  /** Share of the model's claims that passed verification. */
  keptShare: number;
  /** Share of slots where the provider or the request failed, which looks like "no claims" without this. */
  errorShare: number;
}

/** A slot failed outright when its drop reasons say the provider or the request failed. */
const isFailure = (reason: string) =>
  /^(provider error|request failed|support check failed)/.test(reason);

export function narrativeSummary(traces: DecisionTrace[]): NarrativeSummary {
  const records = traces.flatMap((t) => t.narrative);
  const claimsIn = records.reduce((n, r) => n + r.claimsIn, 0);
  const claimsKept = records.reduce((n, r) => n + r.claimsKept, 0);
  return {
    slots: records.length,
    aiShare: ratio(records.filter((r) => r.source === "ai").length, records.length),
    claimsIn,
    claimsKept,
    keptShare: ratio(claimsKept, claimsIn),
    errorShare: ratio(records.filter((r) => r.dropped.some(isFailure)).length, records.length),
  };
}

export interface MetricsSummary {
  traces: number;
  overrideRate: number;
  unwantedMorphRate: number;
  clarifyRate: number;
  fallbackRate: number;
  calibration: CalibrationRow[];
  narrative: NarrativeSummary;
  p50TotalMs: number;
  p95TotalMs: number;
}

export function summarize(traces: DecisionTrace[], events: TimedEvent[]): MetricsSummary {
  const totals = traces.map((t) => t.timings.totalMs);
  return {
    traces: traces.length,
    overrideRate: overrideRate(traces, events),
    unwantedMorphRate: unwantedMorphRate(traces, events),
    clarifyRate: clarifyRate(traces),
    fallbackRate: fallbackRate(traces),
    calibration: calibrationTable(traces, events),
    narrative: narrativeSummary(traces),
    p50TotalMs: percentile(totals, 50),
    p95TotalMs: percentile(totals, 95),
  };
}
