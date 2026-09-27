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
export declare function isLeaf(node: TreeNode): boolean;
export declare function leaves(node: TreeNode): TreeNode[];
export declare function findNode(root: TreeNode, id: string): TreeNode | undefined;
/** Node IDs from the root to `id` (inclusive), or null when absent. */
export declare function pathTo(root: TreeNode, id: string): string[] | null;
/** Internal nodes that become questions (≥ 2 children). */
export declare function decisionNodes(root: TreeNode): TreeNode[];
/** Option label for a child: the last dot-separated segment (snake_case). */
export declare function childLabel(child: TreeNode): string;
export declare function questionId(node: TreeNode): string;
export declare class TreeValidationError extends Error {
    readonly name = "TreeValidationError";
}
/** Unique IDs, questions on decision nodes, unique snake_case child labels. */
export declare function validateTree(root: TreeNode): void;
