import { z } from "zod";
import type { LensId } from "../context/lens";

export const SPEC_ID_RE = /^[a-z][a-z0-9_.]*$/;
export const LABEL_RE = /^[a-z][a-z0-9_]*$/;

const nonEmpty = z.string().trim().min(1, "must be non-empty");

const specBase = {
  id: z.string().regex(SPEC_ID_RE, "id must match /^[a-z][a-z0-9_.]*$/"),
  instructions: nonEmpty,
  lens: nonEmpty,
  dependsOn: z.array(z.string()).optional(),
};

export const ChoiceSpecSchema = z.object({
  ...specBase,
  kind: z.literal("choice"),
  options: z
    .record(z.string(), nonEmpty)
    .refine((o) => Object.keys(o).length >= 2, "a choice needs at least 2 options")
    .refine(
      (o) => Object.keys(o).every((k) => LABEL_RE.test(k)),
      "option labels must be snake_case",
    ),
});

export const ScoreSpecSchema = z.object({
  ...specBase,
  kind: z.literal("score"),
  levels: z
    .array(nonEmpty)
    .min(2, "a score needs 2–10 levels")
    .max(10, "a score needs 2–10 levels"),
});

export const NoulSpecSchema = z.object({
  ...specBase,
  kind: z.literal("noul"),
  criteria: z.object({ true: nonEmpty, false: nonEmpty }).optional(),
});

export const DecisionSpecSchema = z.discriminatedUnion("kind", [
  ChoiceSpecSchema,
  ScoreSpecSchema,
  NoulSpecSchema,
]);

interface SpecBase {
  id: string;
  instructions: string;
  lens: LensId;
  dependsOn?: string[];
}

export type DecisionSpec =
  | (SpecBase & { kind: "choice"; options: Record<string, string> })
  | (SpecBase & { kind: "score"; levels: [string, string, ...string[]] })
  | (SpecBase & { kind: "noul"; criteria?: { true: string; false: string } });

export type ChoiceSpec = Extract<DecisionSpec, { kind: "choice" }>;
export type ScoreSpec = Extract<DecisionSpec, { kind: "score" }>;
export type NoulSpec = Extract<DecisionSpec, { kind: "noul" }>;

export class SpecValidationError extends Error {
  override readonly name = "SpecValidationError";
  constructor(readonly issues: string[]) {
    super(`Invalid decision specs:\n- ${issues.join("\n- ")}`);
  }
}

/** Validate a batch of specs: shape, unique IDs, dependsOn references, no cycles. */
export function validateSpecs(input: unknown[]): DecisionSpec[] {
  const issues: string[] = [];
  const specs: DecisionSpec[] = [];
  input.forEach((raw, i) => {
    const res = DecisionSpecSchema.safeParse(raw);
    if (!res.success) {
      const id = typeof raw === "object" && raw && "id" in raw ? String(raw.id) : `#${i}`;
      for (const issue of res.error.issues) {
        issues.push(`${id}: ${issue.path.join(".") || "(root)"} ${issue.message}`);
      }
    } else {
      specs.push(res.data as DecisionSpec);
    }
  });
  const ids = new Set<string>();
  for (const s of specs) {
    if (ids.has(s.id)) issues.push(`${s.id}: duplicate id`);
    ids.add(s.id);
  }
  for (const s of specs) {
    for (const d of s.dependsOn ?? []) {
      if (!ids.has(d)) issues.push(`${s.id}: dependsOn unknown spec "${d}"`);
    }
  }
  if (issues.length === 0) {
    const cycle = findCycle(specs);
    if (cycle) issues.push(`dependsOn cycle: ${cycle.join(" → ")}`);
  }
  if (issues.length) throw new SpecValidationError(issues);
  return specs;
}

function findCycle(specs: DecisionSpec[]): string[] | null {
  const byId = new Map(specs.map((s) => [s.id, s]));
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === "done") return null;
    if (state.get(id) === "visiting") return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, "visiting");
    stack.push(id);
    for (const d of byId.get(id)?.dependsOn ?? []) {
      const c = visit(d);
      if (c) return c;
    }
    stack.pop();
    state.set(id, "done");
    return null;
  };
  for (const s of specs) {
    const c = visit(s.id);
    if (c) return c;
  }
  return null;
}

/** Option labels (choice) or level indices as strings (score). */
export function specKeys(spec: DecisionSpec): string[] {
  if (spec.kind === "choice") return Object.keys(spec.options);
  if (spec.kind === "score") return spec.levels.map((_, i) => String(i));
  return [];
}
