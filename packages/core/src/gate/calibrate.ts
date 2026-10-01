// Threshold calibration from stored traces (docs/backlog.md#threshold-calibration, ADR 0008).
// Pure: it suggests `autoThreshold` values per model version and never applies them. A human
// reviews the suggestion and replays the goldens before changing the gate config.
import type { RiskLevel } from "../context/types";
import type { DecisionTrace, TimedEvent } from "../trace/types";
import { defaultGateConfig, type GateConfig } from "./gate";

export type CalibratedRisk = Exclude<RiskLevel, "critical">;
export const CALIBRATED_RISKS: CalibratedRisk[] = ["low", "medium", "high"];

/** Share of auto/confirm outcomes that must be kept (not overridden, not declined). */
export const DEFAULT_ACCEPT_TARGETS: Record<CalibratedRisk, number> = {
  low: 0.9,
  medium: 0.95,
  high: 0.99,
};

export interface CalibrateOptions {
  /** The config the traces ran with (default: `defaultGateConfig`). */
  base?: GateConfig;
  targets?: Partial<Record<CalibratedRisk, number>>;
  /** Observations needed at or above a threshold before it can be suggested (default 30). */
  minSamples?: number;
  /** An auto morph overridden within this window counts as unwanted (default 10 s). */
  windowMs?: number;
}

export interface RiskCalibration {
  risk: CalibratedRisk;
  /** Auto/confirm outcomes with a known result at this risk level. */
  samples: number;
  current: number;
  suggested: number;
  /** Outcomes at or above `suggested`, and the share of them that were kept. */
  samplesAbove: number;
  acceptedAbove: number;
  note: string;
}

export interface ModelCalibration {
  /** Versioned model ID that answered (or the provider name when there is none). */
  model: string;
  traces: number;
  risks: RiskCalibration[];
  /** Suggested partial gate config; pass to `createMorph({ gate })` after review. */
  gate: { autoThreshold: Record<RiskLevel, number> };
}

interface Observation {
  confidence: number;
  accepted: boolean;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** The model a trace's decisions came from: every successful batch's model or provider. */
export function traceModel(t: DecisionTrace): string {
  const names = new Set(t.batches.filter((b) => !b.error).map((b) => b.model ?? b.provider));
  return names.size ? [...names].sort().join("+") : "none";
}

function outcomeOf(t: DecisionTrace, events: TimedEvent[], windowMs: number): boolean | null {
  const kind = t.gate.outcome.kind;
  if (kind === "auto") {
    return !events.some(
      (e) => e.type === "override" && e.traceId === t.id && e.at >= t.at && e.at - t.at <= windowMs,
    );
  }
  if (kind === "confirm") {
    const c = events.find((e) => e.type === "confirm" && e.traceId === t.id);
    return c && c.type === "confirm" ? c.accepted : null;
  }
  return null;
}

function fitThreshold(
  obs: Observation[],
  current: number,
  target: number,
  minSamples: number,
  floor: number,
): Omit<RiskCalibration, "risk" | "samples" | "current"> {
  const keep = (xs: Observation[]) => ({
    samplesAbove: xs.length,
    acceptedAbove: xs.length ? round2(xs.filter((o) => o.accepted).length / xs.length) : 0,
  });
  if (obs.length < minSamples) {
    return {
      suggested: current,
      ...keep(obs.filter((o) => o.confidence >= current)),
      note: `Not enough data: ${obs.length} of ${minSamples} outcomes. Keeping ${current}.`,
    };
  }
  // No outcomes exist below the lowest observed confidence (the gate clarified there), so the
  // search never goes lower than the data.
  const lowest = Math.max(floor, Math.floor(Math.min(...obs.map((o) => o.confidence)) * 100) / 100);
  for (let c = Math.round(lowest * 100); c <= 99; c++) {
    const t = c / 100;
    const above = obs.filter((o) => o.confidence >= t);
    if (above.length < minSamples) break;
    const k = keep(above);
    if (k.acceptedAbove >= target) {
      const verb = t < current ? "Lower" : t > current ? "Raise" : "Keep";
      return {
        suggested: t,
        ...k,
        note: `${verb} to ${t}: ${Math.round(k.acceptedAbove * 100)}% of ${k.samplesAbove} outcomes at or above it were kept (target ${Math.round(target * 100)}%).`,
      };
    }
  }
  return {
    suggested: current,
    ...keep(obs.filter((o) => o.confidence >= current)),
    note: `No threshold with ${minSamples}+ outcomes reaches the ${Math.round(target * 100)}% target. Keeping ${current}; review the overrides.`,
  };
}

/**
 * Suggests auto thresholds per model version and risk level: the lowest threshold whose
 * auto/confirm outcomes at or above it were kept at least as often as the target. Uses the
 * `risk` and `confidence` the gate recorded in each trace; older traces without them are ignored.
 */
export function calibrateGate(
  traces: DecisionTrace[],
  events: TimedEvent[],
  opts: CalibrateOptions = {},
): ModelCalibration[] {
  const base = opts.base ?? defaultGateConfig;
  const targets = { ...DEFAULT_ACCEPT_TARGETS, ...opts.targets };
  const minSamples = opts.minSamples ?? 30;
  const windowMs = opts.windowMs ?? 10_000;

  const byModel = new Map<string, DecisionTrace[]>();
  for (const t of traces) {
    const m = traceModel(t);
    byModel.set(m, [...(byModel.get(m) ?? []), t]);
  }

  return [...byModel.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([model, ts]) => {
      const risks = CALIBRATED_RISKS.map((risk): RiskCalibration => {
        const obs: Observation[] = [];
        for (const t of ts) {
          if (t.gate.risk !== risk || t.gate.confidence === undefined) continue;
          const accepted = outcomeOf(t, events, windowMs);
          if (accepted !== null) obs.push({ confidence: t.gate.confidence, accepted });
        }
        const current = base.autoThreshold[risk];
        return {
          risk,
          samples: obs.length,
          current,
          ...fitThreshold(obs, current, targets[risk], minSamples, base.floor),
        };
      });
      // A riskier level never gets a lower threshold than a safer one.
      for (let i = 1; i < risks.length; i++) {
        const prev = risks[i - 1] as RiskCalibration;
        const r = risks[i] as RiskCalibration;
        if (r.suggested < prev.suggested) {
          r.note += ` Raised to ${prev.suggested} to stay at or above the ${prev.risk}-risk threshold.`;
          r.suggested = prev.suggested;
        }
      }
      const autoThreshold = { ...base.autoThreshold };
      for (const r of risks) autoThreshold[r.risk] = r.suggested;
      return { model, traces: ts.length, risks, gate: { autoThreshold } };
    });
}
