import type { MorphContext } from "../context/types";
import type { Answers } from "../decisions/answer";
import { nearestLevel } from "../decisions/normalize";
import type { Facts } from "../facts/types";
import type { Policy, PolicyDecision } from "../policy/policy";
import type { CapabilityRegistry } from "../registry/registry";
import type { ComponentInstance, Density, MorphUIState, WorkspaceTemplate } from "./types";

export const SLOT_ORDER = { header: 0, main: 1, side: 2, footer: 3 } as const;

export function sortComponents(components: ComponentInstance[]): ComponentInstance[] {
  return [...components].sort(
    (a, b) =>
      SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot] ||
      a.priority - b.priority ||
      a.id.localeCompare(b.id),
  );
}

/** Density from the `density` score answer (expected rounded to the nearest level); default 1. */
export function densityFrom(answers: Answers, specId = "density"): Density {
  const a = answers[specId];
  if (a?.kind !== "score") return 1;
  const levels = Object.keys(a.probabilities).length;
  return Math.min(2, nearestLevel(a.expected, levels)) as Density;
}

export interface ComposeInput {
  template: WorkspaceTemplate;
  facts: Facts;
  answers: Answers;
  ctx: MorphContext;
  registry: CapabilityRegistry;
  policy: Policy;
  traceId: string;
  filter: string | null;
  density?: Density;
  alternates?: MorphUIState["alternates"];
  pending?: MorphUIState["pending"];
}

export interface ComposeResult {
  state: MorphUIState;
  /** Per-component policy decisions (defense in depth, SPEC §10). */
  policy: { subject: string; decision: PolicyDecision }[];
  removed: string[];
  /** A required component was denied: the candidate is invalid. */
  invalid: boolean;
  /** Props that failed Zod validation (the renderer shows MorphError for these). */
  validation: { componentId: string; error: string }[];
}

/** Deterministic composition: template → components → policy → prop validation. */
export function compose(input: ComposeInput): ComposeResult {
  const { template, facts, answers, ctx, registry, policy } = input;
  const density = input.density ?? densityFrom(answers);
  const filter =
    input.filter !== null && template.supportsFilters.includes(input.filter) ? input.filter : null;
  const built = template.build({ facts, answers, ctx, density, filter });
  const policyLog: ComposeResult["policy"] = [];
  const removed: string[] = [];
  const validation: ComposeResult["validation"] = [];
  const kept: ComponentInstance[] = [];
  for (const c of built) {
    const cap = registry.get(c.type);
    if (!cap) {
      removed.push(c.id);
      policyLog.push({
        subject: c.id,
        decision: {
          allowed: false,
          rule: "registry",
          reason: `Unknown capability type "${c.type}".`,
        },
      });
      continue;
    }
    const decision = policy.canRender(cap, ctx);
    if (!decision.allowed) {
      removed.push(c.id);
      policyLog.push({ subject: c.id, decision });
      continue;
    }
    const v = registry.validateProps(c.type, c.props);
    if (!v.ok) validation.push({ componentId: c.id, error: v.error });
    kept.push(c);
  }
  const invalid = template.required.some(
    (id) => removed.includes(id) || !built.some((c) => c.id === id),
  );
  const state: MorphUIState = {
    version: 1,
    workspaceId: template.leafId,
    title: template.title(facts, answers),
    layout: template.layout,
    density,
    filter,
    components: sortComponents(kept),
    alternates: input.alternates ?? [],
    pending: input.pending ?? null,
    traceId: input.traceId,
  };
  return { state, policy: policyLog, removed, invalid, validation };
}
