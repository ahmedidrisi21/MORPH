import type { LensId } from "../context/lens";
import type { JsonValue } from "../context/types";
import type { Answers } from "../decisions/answer";
import type { DecisionSpec } from "../decisions/spec";
import type { DecisionTrace, TimedEvent } from "../trace/types";

/** One logged turn for research: the lens state, the answers it got, and what the user kept. */
export interface ResearchTurn {
  id: string;
  state: JsonValue;
  answers: Answers;
  /** Workspace the user ended on: the override target, the confirmed target, or the result. */
  label: string;
}

/**
 * Turns with a known outcome, from traces that kept their lens content (`traceFull`, or a
 * store that saves it). Overrides are the strongest label; a declined confirm or an unanswered
 * clarify/alternates has no label and is left out.
 */
export function researchTurns(
  traces: DecisionTrace[],
  events: TimedEvent[],
  opts: { lens?: LensId } = {},
): ResearchTurn[] {
  const lens = opts.lens ?? "core";
  const out: ResearchTurn[] = [];
  for (const t of traces) {
    const state = t.lensStates[lens]?.content;
    if (state === undefined) continue;
    const mine = events.filter((e) => e.traceId === t.id).sort((a, b) => a.at - b.at);
    const override = mine.filter((e) => e.type === "override").at(-1);
    const confirm = mine.find((e) => e.type === "confirm");
    const o = t.gate.outcome;
    let label: string | null = null;
    if (override?.type === "override") label = override.to;
    else if (o.kind === "confirm")
      label = confirm?.type === "confirm" && confirm.accepted ? o.target.leafId : null;
    else if (o.kind === "auto") label = o.target.leafId;
    else if (o.kind === "refine" || o.kind === "stay") label = t.result?.workspaceId ?? null;
    if (label) out.push({ id: t.id, state, answers: t.answers, label });
  }
  return out;
}

/**
 * Minimal specs rebuilt from logged answers (option labels, level count, kind), for feature
 * extraction when the app's spec definitions are not at hand, e.g. in a CLI reading traces.
 * The question text is the spec ID. Sorted by ID.
 */
export function specsFromAnswers(
  turns: { answers: Answers }[],
  lens: LensId = "core",
): DecisionSpec[] {
  const out = new Map<string, DecisionSpec>();
  for (const t of turns) {
    for (const [id, a] of Object.entries(t.answers)) {
      if (out.has(id)) continue;
      if (a.kind === "choice") {
        const options = Object.fromEntries(Object.keys(a.probabilities).map((k) => [k, k]));
        if (Object.keys(options).length >= 2)
          out.set(id, { id, kind: "choice", lens, instructions: id, options });
      } else if (a.kind === "score") {
        const n = Object.keys(a.probabilities).length;
        if (n >= 2) {
          const levels = Array.from({ length: n }, (_, i) => String(i)) as [
            string,
            string,
            ...string[],
          ];
          out.set(id, { id, kind: "score", lens, instructions: id, levels });
        }
      } else {
        out.set(id, { id, kind: "noul", lens, instructions: id });
      }
    }
  }
  return [...out.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}
