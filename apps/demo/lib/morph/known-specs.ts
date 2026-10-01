import { buildTreeQuestions, canonicalJSON, type DecisionSpec } from "@morph/core";
import { specs } from "./specs";
import { tree } from "./tree";

// The decide route only evaluates specs the app defines (Appendix B): the static MVP set, and
// tree questions whose options are a subset of the full tree question (pruning removes options).

const staticById = new Map(specs.map((s) => [s.id, canonicalJSON(s)]));
const treeById = new Map(buildTreeQuestions(tree).map((q) => [q.id, q]));

export const knownSpecIds: ReadonlySet<string> = new Set([
  ...staticById.keys(),
  ...treeById.keys(),
]);

/** Returns null when the spec is one the app defines, or a short reason when it is not. */
export function unknownSpecReason(spec: DecisionSpec): string | null {
  const known = staticById.get(spec.id);
  if (known !== undefined) {
    return canonicalJSON(spec) === known ? null : `${spec.id}: does not match the app's spec`;
  }
  const q = treeById.get(spec.id);
  if (!q) return `${spec.id}: unknown spec id`;
  if (spec.kind !== "choice" || spec.instructions !== q.instructions || spec.lens !== q.lens) {
    return `${spec.id}: does not match the app's tree question`;
  }
  if (spec.dependsOn?.length) return `${spec.id}: tree questions have no dependencies`;
  for (const [label, description] of Object.entries(spec.options)) {
    if (q.options[label] !== description) return `${spec.id}: unknown option "${label}"`;
  }
  return null;
}
