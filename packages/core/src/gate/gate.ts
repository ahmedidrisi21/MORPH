import type { RiskLevel, Trigger } from "../context/types";
import type { Answers } from "../decisions/answer";
import { type Candidate, pathConfidence, separation as separationOf } from "../resolver/beam";

export type GateOutcome =
  | { kind: "auto"; target: Candidate }
  | { kind: "confirm"; target: Candidate }
  | { kind: "alternates"; options: [Candidate, Candidate] }
  | { kind: "clarify"; options: Candidate[]; filters?: string[] }
  | { kind: "refine"; filter: string }
  | { kind: "stay"; reason: string };

export interface GateConfig {
  floor: number;
  autoThreshold: Record<RiskLevel, number>;
  confirmBand: number;
  minSeparation: number;
  hysteresisMargin: number;
  /** Applies to non-intent triggers only. */
  cooldownMs: number;
  /** Confidence cap for providers with calibrated = false. */
  uncalibratedCap: number;
  beamWidth: number;
  fullTreeMaxNodes: number;
}

export const defaultGateConfig: GateConfig = {
  floor: 0.5,
  autoThreshold: { low: 0.75, medium: 0.85, high: 0.95, critical: Number.POSITIVE_INFINITY },
  confirmBand: 0.15,
  minSeparation: 1.25,
  hysteresisMargin: 0.1,
  cooldownMs: 1500,
  uncalibratedCap: 0.8,
  beamWidth: 3,
  fullTreeMaxNodes: 24,
};

export function resolveGateConfig(partial: Partial<GateConfig> = {}): GateConfig {
  return {
    ...defaultGateConfig,
    ...partial,
    autoThreshold: { ...defaultGateConfig.autoThreshold, ...(partial.autoThreshold ?? {}) },
  };
}

export interface GateInput {
  candidates: Candidate[];
  answers: Answers;
  config: GateConfig;
  trigger: Trigger;
  now: number;
  current: { workspaceId: string | null; lastMorphAt: number | null; score: number };
  /** Filters supported by a leaf's template. */
  supportsFilters(leafId: string): string[];
  /** Max risk of the capabilities in a leaf's template. */
  riskOf(leafId: string): RiskLevel;
  /** Whether the answers behind the tree questions came from a calibrated provider. */
  treeCalibrated: boolean;
}

export interface GateResult {
  outcome: GateOutcome;
  reason: string;
  /** Filter to apply with the outcome (refine, or a filter carried to a new workspace). */
  filter: string | null;
  /** Candidates after any filter restriction (step 3). */
  candidates: Candidate[];
}

/** Deterministic gate (SPEC §9), evaluated in order. */
export function runGate(input: GateInput): GateResult {
  const { config, answers } = input;
  const cap = (x: number, calibrated: boolean) =>
    calibrated ? x : Math.min(x, config.uncalibratedCap);
  let candidates = input.candidates;
  let carriedFilter: string | null = null;
  const done = (
    outcome: GateOutcome,
    reason: string,
    filter: string | null = carriedFilter,
  ): GateResult => ({
    outcome,
    reason,
    filter,
    candidates,
  });
  const top2 = () => candidates.slice(0, 2);

  if (candidates.length === 0)
    return done(
      { kind: "stay", reason: "no workspace available" },
      "No candidate workspaces survived pruning.",
    );

  // Step 2: unclear turn.
  const turn = answers.turn_type;
  if (turn?.kind === "choice") {
    const tc = cap(turn.confidence, turn.meta.calibrated);
    if (tc < config.floor) {
      return done(
        { kind: "clarify", options: top2() },
        `turn_type confidence ${tc.toFixed(2)} < floor ${config.floor}.`,
      );
    }
    if (turn.value === "unclear") {
      return done({ kind: "clarify", options: top2() }, "turn_type = unclear.");
    }
  }

  // Step 3: refine the current workspace.
  const currentId = input.current.workspaceId;
  if (turn?.kind === "choice" && turn.value === "refine_current" && currentId) {
    const rf = answers.refine_filter;
    const supported = input.supportsFilters(currentId);
    if (
      rf?.kind === "choice" &&
      rf.value !== "none" &&
      cap(rf.confidence, rf.meta.calibrated) >= config.autoThreshold.low
    ) {
      if (supported.includes(rf.value)) {
        return done(
          { kind: "refine", filter: rf.value },
          `Refine "${currentId}" with filter "${rf.value}".`,
          rf.value,
        );
      }
      candidates = candidates.filter((c) => input.supportsFilters(c.leafId).includes(rf.value));
      if (candidates.length === 0) {
        return done(
          { kind: "clarify", options: [] },
          `No workspace supports filter "${rf.value}".`,
          null,
        );
      }
      carriedFilter = rf.value;
    } else {
      const outcome: GateOutcome = { kind: "clarify", options: top2() };
      if (supported.length) outcome.filters = supported;
      return done(
        outcome,
        "Refinement requested, but the filter is unclear or not confident enough.",
        null,
      );
    }
  }

  // Step 4: already showing.
  const top = candidates[0] as Candidate;
  if (top.leafId === currentId) {
    return done(
      { kind: "stay", reason: "already showing" },
      `Top candidate "${top.leafId}" is already shown.`,
    );
  }

  // Step 5: torn between two.
  const sep = separationOf(candidates);
  if (sep < config.minSeparation && candidates.length >= 2) {
    return done(
      { kind: "alternates", options: [top, candidates[1] as Candidate] },
      `Separation ${sep.toFixed(2)} < ${config.minSeparation}.`,
    );
  }

  // Step 6: hysteresis.
  if (currentId && top.score - input.current.score < config.hysteresisMargin) {
    return done(
      { kind: "stay", reason: "not clearly better than the current workspace" },
      `Top score ${top.score.toFixed(2)} − current ${input.current.score.toFixed(2)} < margin ${config.hysteresisMargin}.`,
    );
  }

  // Step 7: cooldown for non-intent triggers.
  if (
    input.trigger !== "intent" &&
    input.current.lastMorphAt !== null &&
    input.now - input.current.lastMorphAt < config.cooldownMs
  ) {
    return done(
      { kind: "stay", reason: "cooldown" },
      `Last morph ${input.now - input.current.lastMorphAt} ms ago < ${config.cooldownMs} ms.`,
    );
  }

  // Step 8: confidence vs. risk.
  const risk = input.riskOf(top.leafId);
  const t = config.autoThreshold[risk];
  const pc = cap(pathConfidence(top), input.treeCalibrated);
  const detail = `path confidence ${pc.toFixed(2)} vs ${risk}-risk threshold ${t}`;
  if (pc >= t) return done({ kind: "auto", target: top }, `Auto: ${detail}.`);
  if (pc >= t - config.confirmBand)
    return done(
      { kind: "confirm", target: top },
      `Confirm: ${detail} (band ${config.confirmBand}).`,
    );
  return done({ kind: "clarify", options: top2() }, `Clarify: ${detail}.`);
}
