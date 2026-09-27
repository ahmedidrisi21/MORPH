import { describe, expect, it } from "vitest";
import { tree } from "../__fixtures__/miniApp";
import type { Answers, ChoiceAnswer } from "../decisions/answer";
import { validateSpecs } from "../decisions/spec";
import {
  beamSearch,
  beamSearchLevelwise,
  bruteForce,
  leafScore,
  pathConfidence,
  pathScore,
  separation,
} from "./beam";
import { pruneTree } from "./prune";
import { buildTreeQuestions } from "./questions";
import {
  childLabel,
  decisionNodes,
  findNode,
  leaves,
  pathTo,
  questionId,
  type TreeNode,
  TreeValidationError,
  validateTree,
} from "./tree";

const meta = { provider: "t", model: null, calibrated: true, latencyMs: 0, cached: false };
function choice(probabilities: Record<string, number>, confidence?: number): ChoiceAnswer {
  const value = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]?.[0] as string;
  return {
    kind: "choice",
    value,
    probabilities,
    confidence: confidence ?? (probabilities[value] as number),
    meta,
  };
}

describe("tree helpers", () => {
  it("navigates the tree", () => {
    expect(leaves(tree).map((l) => l.id)).toHaveLength(6);
    expect(findNode(tree, "customers.list")?.description).toBe("All customers.");
    expect(findNode(tree, "nope")).toBeUndefined();
    expect(pathTo(tree, "investigation.by_time")).toEqual([
      "root",
      "investigation",
      "investigation.by_time",
    ]);
    expect(pathTo(tree, "nope")).toBeNull();
    expect(decisionNodes(tree).map(questionId)).toEqual([
      "ws.root",
      "ws.investigation",
      "ws.customers",
    ]);
    expect(childLabel({ id: "a.b_c", description: "x" })).toBe("b_c");
  });
  it("validates trees", () => {
    expect(() => validateTree(tree)).not.toThrow();
    const dup: TreeNode = {
      id: "r",
      description: "",
      question: "Q",
      children: [
        { id: "a", description: "A" },
        { id: "a", description: "B" },
      ],
    };
    expect(() => validateTree(dup)).toThrow(TreeValidationError);
    const noQ: TreeNode = {
      id: "r",
      description: "",
      children: [
        { id: "a", description: "A" },
        { id: "b", description: "B" },
      ],
    };
    expect(() => validateTree(noQ)).toThrow(/question/);
    const dupLabel: TreeNode = {
      id: "r",
      description: "",
      question: "Q",
      children: [
        { id: "x.a", description: "A" },
        { id: "y.a", description: "B" },
      ],
    };
    expect(() => validateTree(dupLabel)).toThrow(/duplicate labels/);
    const badLabel: TreeNode = {
      id: "r",
      description: "",
      question: "Q",
      children: [
        { id: "A-1", description: "A" },
        { id: "b", description: "B" },
      ],
    };
    expect(() => validateTree(badLabel)).toThrow(/snake_case/);
    const noDesc: TreeNode = {
      id: "r",
      description: "",
      children: [{ id: "a", description: " " }],
    };
    expect(() => validateTree(noDesc)).toThrow(/description/);
  });
});

describe("pruneTree", () => {
  it("removes leaves and then empty internal nodes", () => {
    const res = pruneTree(tree, (id) =>
      id.startsWith("customers.") || id === "investigation.by_time" ? "nope" : null,
    );
    expect(res.pruned.map((p) => p.leafId)).toEqual([
      "investigation.by_time",
      "customers.list",
      "customers.at_risk",
    ]);
    expect(res.tree && findNode(res.tree, "customers")).toBeUndefined();
    expect(res.tree && findNode(res.tree, "investigation")?.children).toHaveLength(1);
    expect(pruneTree(tree, () => "all").tree).toBeNull();
  });
});

describe("buildTreeQuestions", () => {
  it("builds one valid choice per decision node", () => {
    const qs = buildTreeQuestions(tree);
    expect(() => validateSpecs(qs)).not.toThrow();
    expect(qs.map((q) => q.id)).toEqual(["ws.root", "ws.investigation", "ws.customers"]);
    expect(qs[0]?.options).toEqual({
      overview: "A general summary.",
      investigation: "Explains why a metric changed.",
      customers: "Lists customers.",
      action: "Suggests what to do.",
    });
    const noQuestion = buildTreeQuestions({
      id: "r",
      description: "",
      children: [
        { id: "a", description: "A" },
        { id: "b", description: "B" },
      ],
    });
    expect(noQuestion[0]?.instructions).toContain("intent");
  });
});

describe("beamSearch", () => {
  const answers: Answers = {
    "ws.root": choice({ overview: 0.05, investigation: 0.8, customers: 0.1, action: 0.05 }),
    "ws.investigation": choice({ by_time: 0.7, by_customer: 0.3 }),
    "ws.customers": choice({ list: 0.9, at_risk: 0.1 }),
  };
  it("ranks leaves by geometric mean over decision edges", () => {
    const { candidates, separation: sep } = beamSearch(tree, answers, 3);
    expect(candidates[0]?.leafId).toBe("investigation.by_time");
    expect(candidates[0]?.score).toBeCloseTo(Math.sqrt(0.8 * 0.7));
    expect(candidates[0]?.edgeConfidences).toEqual([0.8, 0.7]);
    expect(sep).toBeCloseTo(Math.sqrt(0.56) / Math.sqrt(0.24));
  });
  it("does not count single-child edges as decisions", () => {
    const all = bruteForce(tree, answers);
    const action = all.find((c) => c.leafId === "action.recommendations");
    expect(action?.score).toBeCloseTo(0.05);
    expect(action?.edgeConfidences).toEqual([0.05]);
    expect(leafScore(tree, answers, "overview.default")).toBeCloseTo(0.05);
    expect(leafScore(tree, answers, "missing")).toBe(0);
  });
  it("uses uniform edges when a question is unanswered", () => {
    const top = beamSearch(tree, {}, 10).candidates;
    expect(top).toHaveLength(6);
    expect(top[0]?.score).toBeCloseTo(Math.sqrt(0.25 * 0.5));
  });
  it("edge confidence is the answer confidence on the chosen label", () => {
    const a: Answers = {
      ...answers,
      "ws.root": choice({ overview: 0.05, investigation: 0.8, customers: 0.1, action: 0.05 }, 0.99),
    };
    expect(beamSearch(tree, a).candidates[0]?.edgeConfidences[0]).toBe(0.99);
  });
  it("helpers", () => {
    expect(pathScore([])).toBe(1);
    expect(pathConfidence({ leafId: "x", path: [], score: 1, edgeConfidences: [] })).toBe(1);
    expect(separation([])).toBe(0);
    expect(
      separation([{ leafId: "x", path: [], score: 0.5, edgeConfidences: [] }]),
    ).toBeGreaterThan(1e6);
  });

  it("property: with K ≥ leaves, beam search finds the brute-force top leaf", () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 2 ** 32;
      return seed / 2 ** 32;
    };
    const makeTree = (depth: number, id: string): TreeNode => {
      if (depth === 0 || rand() < 0.3) return { id, description: id };
      const n = 1 + Math.floor(rand() * 3);
      return {
        id,
        description: id,
        question: "Q",
        children: Array.from({ length: n }, (_, i) => makeTree(depth - 1, `${id}_${i}`)),
      };
    };
    for (let trial = 0; trial < 300; trial++) {
      const root = makeTree(4, "n");
      const a: Answers = {};
      for (const node of decisionNodes(root)) {
        const raw = (node.children ?? []).map(() => rand() + 0.01);
        const z = raw.reduce((x, y) => x + y, 0);
        const probs: Record<string, number> = {};
        (node.children ?? []).forEach((c, i) => {
          probs[childLabel(c)] = (raw[i] as number) / z;
        });
        a[questionId(node)] = choice(probs);
      }
      const k = leaves(root).length;
      const beam = beamSearch(root, a, k).candidates[0];
      const brute = bruteForce(root, a)[0];
      expect(beam?.leafId).toBe(brute?.leafId);
      expect(beam?.score).toBeCloseTo(brute?.score as number, 12);
    }
  });

  it("level-wise search asks only frontier questions, one depth at a time", async () => {
    const asked: string[][] = [];
    const res = await beamSearchLevelwise(
      tree,
      async (nodes) => {
        asked.push(nodes.map(questionId));
        const out: Answers = {};
        for (const n of nodes) {
          const a = answers[questionId(n)];
          if (a) out[questionId(n)] = a;
        }
        return out;
      },
      1,
    );
    expect(asked[0]).toEqual(["ws.root"]);
    expect(asked.flat()).not.toContain("ws.customers");
    expect(res.candidates[0]?.leafId).toBe("investigation.by_time");
    expect(Object.keys(res.answers)).toContain("ws.investigation");
  });
});
