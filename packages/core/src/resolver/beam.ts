import type { Answers } from "../decisions/answer";
import { childLabel, isLeaf, questionId, type TreeNode } from "./tree";

export interface Candidate {
  leafId: string;
  path: string[];
  score: number;
  edgeConfidences: number[];
}

export const MIN_P = 1e-9;

/** Geometric mean of edge probabilities over decision edges (1 when there are none). */
export function pathScore(logs: number[]): number {
  if (logs.length === 0) return 1;
  return Math.exp(logs.reduce((a, b) => a + b, 0) / logs.length);
}

export function pathConfidence(c: Candidate): number {
  return c.edgeConfidences.length ? Math.min(...c.edgeConfidences) : 1;
}

export function separation(candidates: Candidate[]): number {
  const a = candidates[0]?.score ?? 0;
  const b = candidates[1]?.score ?? 0;
  return a / Math.max(b, MIN_P);
}

interface Partial {
  node: TreeNode;
  path: string[];
  logs: number[];
  confs: number[];
}

interface Edge {
  child: TreeNode;
  log: number | null;
  conf: number | null;
}

/** Edges out of a node: decision edges carry probability + confidence; single-child edges don't count. */
export function edges(node: TreeNode, answers: Answers): Edge[] {
  const kids = node.children ?? [];
  if (kids.length === 1) return [{ child: kids[0] as TreeNode, log: null, conf: null }];
  const a = answers[questionId(node)];
  return kids.map((child) => {
    const label = childLabel(child);
    const p = a?.kind === "choice" ? (a.probabilities[label] ?? 0) : 1 / kids.length;
    const conf = a?.kind === "choice" ? (a.value === label ? a.confidence : p) : p;
    return { child, log: Math.log(Math.max(p, MIN_P)), conf };
  });
}

export interface BeamResult {
  candidates: Candidate[];
  separation: number;
}

/** Beam search (width K) over the tree using answered `ws.*` questions. */
export function beamSearch(root: TreeNode, answers: Answers, beamWidth = 3): BeamResult {
  const done: Candidate[] = [];
  let frontier: Partial[] = [{ node: root, path: [root.id], logs: [], confs: [] }];
  while (frontier.length > 0) {
    const next: Partial[] = [];
    for (const p of frontier) {
      if (isLeaf(p.node)) {
        done.push({
          leafId: p.node.id,
          path: p.path,
          score: pathScore(p.logs),
          edgeConfidences: p.confs,
        });
        continue;
      }
      for (const e of edges(p.node, answers)) {
        next.push({
          node: e.child,
          path: [...p.path, e.child.id],
          logs: e.log === null ? p.logs : [...p.logs, e.log],
          confs: e.conf === null ? p.confs : [...p.confs, e.conf],
        });
      }
    }
    next.sort(
      (a, b) => pathScore(b.logs) - pathScore(a.logs) || a.node.id.localeCompare(b.node.id),
    );
    frontier = next.slice(0, beamWidth);
  }
  const candidates = rank(done);
  return { candidates, separation: separation(candidates) };
}

/** Exhaustive search over every leaf (used by tests and for `score(current)`). */
export function bruteForce(root: TreeNode, answers: Answers): Candidate[] {
  const out: Candidate[] = [];
  const visit = (p: Partial) => {
    if (isLeaf(p.node)) {
      out.push({
        leafId: p.node.id,
        path: p.path,
        score: pathScore(p.logs),
        edgeConfidences: p.confs,
      });
      return;
    }
    for (const e of edges(p.node, answers)) {
      visit({
        node: e.child,
        path: [...p.path, e.child.id],
        logs: e.log === null ? p.logs : [...p.logs, e.log],
        confs: e.conf === null ? p.confs : [...p.confs, e.conf],
      });
    }
  };
  visit({ node: root, path: [root.id], logs: [], confs: [] });
  return rank(out);
}

function rank(cs: Candidate[]): Candidate[] {
  return [...cs].sort((a, b) => b.score - a.score || a.leafId.localeCompare(b.leafId));
}

/** Score of a specific leaf in the tree, or 0 when absent (pruned). */
export function leafScore(root: TreeNode, answers: Answers, leafId: string): number {
  return bruteForce(root, answers).find((c) => c.leafId === leafId)?.score ?? 0;
}

/**
 * Level-wise beam search for large trees: one batch per depth, asking only the questions of
 * decision nodes on the beam frontier (SPEC §8.3). Returns the answers it collected.
 */
export async function beamSearchLevelwise(
  root: TreeNode,
  ask: (nodes: TreeNode[]) => Promise<Answers>,
  beamWidth = 3,
): Promise<BeamResult & { answers: Answers }> {
  const answers: Answers = {};
  const done: Candidate[] = [];
  let frontier: Partial[] = [{ node: root, path: [root.id], logs: [], confs: [] }];
  while (frontier.length > 0) {
    const needed = frontier
      .map((p) => p.node)
      .filter((n) => (n.children?.length ?? 0) >= 2 && !answers[questionId(n)]);
    if (needed.length) Object.assign(answers, await ask(needed));
    const next: Partial[] = [];
    for (const p of frontier) {
      if (isLeaf(p.node)) {
        done.push({
          leafId: p.node.id,
          path: p.path,
          score: pathScore(p.logs),
          edgeConfidences: p.confs,
        });
        continue;
      }
      for (const e of edges(p.node, answers)) {
        next.push({
          node: e.child,
          path: [...p.path, e.child.id],
          logs: e.log === null ? p.logs : [...p.logs, e.log],
          confs: e.conf === null ? p.confs : [...p.confs, e.conf],
        });
      }
    }
    next.sort(
      (a, b) => pathScore(b.logs) - pathScore(a.logs) || a.node.id.localeCompare(b.node.id),
    );
    frontier = next.slice(0, beamWidth);
  }
  const candidates = rank(done);
  return { candidates, separation: separation(candidates), answers };
}
