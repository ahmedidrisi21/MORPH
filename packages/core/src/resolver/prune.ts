import type { TreeNode } from "./tree";

export interface PruneResult {
  tree: TreeNode | null;
  pruned: { leafId: string; reason: string }[];
}

/**
 * Remove leaves for which `reasonToPrune` returns a string, then remove internal nodes
 * left with no children. Never offer the model an option the app cannot render (SPEC §8.2).
 */
export function pruneTree(
  root: TreeNode,
  reasonToPrune: (leafId: string) => string | null,
): PruneResult {
  const pruned: PruneResult["pruned"] = [];
  const visit = (n: TreeNode): TreeNode | null => {
    if (!n.children || n.children.length === 0) {
      const reason = reasonToPrune(n.id);
      if (reason) {
        pruned.push({ leafId: n.id, reason });
        return null;
      }
      return n;
    }
    const kids = n.children.map(visit).filter((c): c is TreeNode => c !== null);
    if (kids.length === 0) return null;
    return { ...n, children: kids };
  };
  return { tree: visit(root), pruned };
}
