import type { ChoiceSpec } from "../decisions/spec";
import { childLabel, decisionNodes, questionId, type TreeNode } from "./tree";

/** One Choice per internal node with ≥ 2 children, all on the `core` lens (SPEC §8.3). */
export function buildTreeQuestions(
  root: TreeNode,
  nodes: TreeNode[] = decisionNodes(root),
  lens = "core",
): ChoiceSpec[] {
  return nodes.map((n) => {
    const options: Record<string, string> = {};
    for (const c of n.children ?? []) options[childLabel(c)] = c.description;
    return {
      id: questionId(n),
      kind: "choice",
      instructions: n.question ?? `Which option fits the \`intent\` best?`,
      lens,
      options,
    };
  });
}
