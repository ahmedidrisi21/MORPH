import type { LensId } from "../context/lens";
import type { JsonValue, RiskLevel, Trigger } from "../context/types";
import type { Answers } from "../decisions/answer";
import type { BatchLogEntry } from "../decisions/planner";
import type { UIDiffOp } from "../diff/diff";
import type { GateConfig, GateOutcome } from "../gate/gate";
import type { PolicyDecision } from "../policy/policy";
import type { Candidate } from "../resolver/beam";

/**
 * What the narrative tier did for one insight slot (SPEC §12): the claims the model wrote, how many
 * survived verification, and why the rest were dropped. `source` says what the user saw.
 */
export interface NarrativeRecord {
  slotId: string;
  claimsIn: number;
  claimsKept: number;
  /** One reason per dropped claim, plus why the whole slot failed ("provider error (429)"). */
  dropped: string[];
  /** "ai" when verified model claims were shown, "facts" when the fact sentences were. */
  source?: "ai" | "facts";
}

export interface DecisionTrace {
  id: string;
  at: number;
  trigger: Trigger;
  intent: string;
  /** content only when MORPH_DEV_TRACE_FULL=1 (traceFull option). */
  lensStates: Record<LensId, { hash: string; tokensEst: number; content?: JsonValue }>;
  batches: BatchLogEntry[];
  answers: Answers;
  pruned: { leafId: string; reason: string }[];
  beam: { candidates: Candidate[]; separation: number };
  gate: {
    outcome: GateOutcome;
    reason: string;
    config: GateConfig;
    /** auto/confirm only: the target's risk level and the path confidence the gate compared. */
    risk?: RiskLevel;
    confidence?: number;
  };
  policy: { subject: string; decision: PolicyDecision }[];
  diff: UIDiffOp[];
  narrative: NarrativeRecord[];
  timings: {
    factsMs: number;
    decideMs: number;
    resolveMs: number;
    composeMs: number;
    totalMs: number;
  };
  /** Resulting workspace and filter. */
  result?: { workspaceId: string; filter: string | null };
  /** Components whose props failed Zod validation. */
  validation?: { componentId: string; error: string }[];
  /** Provider failure that forced the runtime to keep the current UI (I11). */
  error?: string;
}

export type MorphEvent =
  | {
      type: "override";
      traceId: string;
      from: string;
      to: string;
      via: "alternate" | "undo" | "clarify";
    }
  | { type: "confirm"; traceId: string; accepted: boolean }
  | { type: "task_complete"; traceId: string; task: string }
  | { type: "render_error"; traceId: string; componentId: string; error: string };

export type TimedEvent = MorphEvent & { at: number };

export interface TraceSink {
  write(t: DecisionTrace): void;
  event(e: MorphEvent): void;
}
