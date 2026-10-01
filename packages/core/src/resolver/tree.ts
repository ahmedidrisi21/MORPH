export interface TreeNode {
  /** "investigation" or leaf "investigation.by_customer" */
  id: string;
  /** Used as the option description in the parent's question. */
  description: string;
  /** Absent → leaf. */
  children?: TreeNode[];
  /** Required on internal nodes with ≥ 2 children. */
  question?: string;
}

export function isLeaf(node: TreeNode): boolean {
  return !node.children || node.children.length === 0;
}

export function leaves(node: TreeNode): TreeNode[] {
  if (isLeaf(node)) return [node];
  return (node.children ?? []).flatMap(leaves);
}

export function findNode(root: TreeNode, id: string): TreeNode | undefined {
  if (root.id === id) return root;
  for (const c of root.children ?? []) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return undefined;
}

/** Node IDs from the root to `id` (inclusive), or null when absent. */
export function pathTo(root: TreeNode, id: string): string[] | null {
  if (root.id === id) return [root.id];
  for (const c of root.children ?? []) {
    const p = pathTo(c, id);
    if (p) return [root.id, ...p];
  }
  return null;
}

/** Internal nodes that become questions (≥ 2 children). */
export function decisionNodes(root: TreeNode): TreeNode[] {
  const out: TreeNode[] = [];
  const visit = (n: TreeNode) => {
    if ((n.children?.length ?? 0) >= 2) out.push(n);
    for (const c of n.children ?? []) visit(c);
  };
  visit(root);
  return out;
}

/** Option label for a child: the last dot-separated segment (snake_case). */
export function childLabel(child: TreeNode): string {
  const parts = child.id.split(".");
  return parts[parts.length - 1] as string;
}

export function questionId(node: TreeNode): string {
  return `ws.${node.id}`;
}

export class TreeValidationError extends Error {
  override readonly name = "TreeValidationError";
}

/** Unique IDs, questions on decision nodes, unique snake_case child labels. */
export function validateTree(root: TreeNode): void {
  const seen = new Set<string>();
  const visit = (n: TreeNode) => {
    if (seen.has(n.id)) throw new TreeValidationError(`Duplicate tree node "${n.id}".`);
    seen.add(n.id);
    if (!n.description.trim() && n !== root)
      throw new TreeValidationError(`Node "${n.id}" needs a description.`);
    const kids = n.children ?? [];
    if (kids.length >= 2 && !n.question?.trim()) {
      throw new TreeValidationError(`Internal node "${n.id}" needs a question.`);
    }
    const labels = kids.map(childLabel);
    if (new Set(labels).size !== labels.length) {
      throw new TreeValidationError(`Children of "${n.id}" have duplicate labels.`);
    }
    for (const l of labels) {
      if (kids.length >= 2 && !/^[a-z][a-z0-9_]*$/.test(l)) {
        throw new TreeValidationError(`Label "${l}" under "${n.id}" is not snake_case.`);
      }
    }
    kids.forEach(visit);
  };
  visit(root);
}
