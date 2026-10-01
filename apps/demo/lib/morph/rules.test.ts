import {
  type Answer,
  buildTreeQuestions,
  type JsonValue,
  validateSpecs,
  validateTree,
} from "morph-core";
import { describe, expect, it } from "vitest";
import { createRulesProvider, rules } from "./rules";
import { specs } from "./specs";
import { tree } from "./tree";

const questions = buildTreeQuestions(tree);
const all = [...specs, ...questions];

function state(intent: string, current = "none (start screen)"): JsonValue {
  return {
    intent,
    previous_intents: [],
    current_workspace: current,
    current_filter: "none",
    available_data: [],
    user_role: "sales_manager",
  };
}

async function ask(intent: string, current?: string) {
  const answers = await createRulesProvider().evaluate({
    state: state(intent, current),
    specs: all,
  });
  const top = (id: string) => {
    const a = answers[id] as Answer;
    if (a.kind === "choice") return a.value;
    if (a.kind === "score") return Math.round(a.expected);
    return a.p > 0.5;
  };
  return { answers, top };
}

describe("MVP specs, tree and rules", () => {
  it("are valid and share the core lens", () => {
    expect(() => validateSpecs(all)).not.toThrow();
    expect(() => validateTree(tree)).not.toThrow();
    expect(all.every((s) => s.lens === "core")).toBe(true);
  });

  it("builds one question per decision node", () => {
    expect(questions.map((q) => q.id).sort()).toEqual([
      "ws.comparison",
      "ws.customers",
      "ws.investigation",
      "ws.root",
    ]);
  });

  it("has a rule for every static spec and every tree question", () => {
    const provider = createRulesProvider();
    for (const s of all) expect(provider.has(s.id), s.id).toBe(true);
    expect(Object.keys(rules).sort()).toEqual(all.map((s) => s.id).sort());
  });

  it("routes the 4-turn demo script", async () => {
    const t1 = await ask(
      "Why did revenue fall?",
      "A general summary of how the business is doing.",
    );
    expect(t1.top("turn_type")).toBe("new_topic");
    expect(t1.top("focus_metric")).toBe("revenue");
    expect(t1.top("ws.root")).toBe("investigation");

    const t2 = await ask("Show me the customers.", "How the metric changed over time.");
    expect(t2.top("turn_type")).toBe("new_topic");
    expect(t2.top("ws.root")).toBe("customers");

    const t3 = await ask("Only show customers I can save.", "All customers.");
    expect(t3.top("turn_type")).toBe("refine_current");
    expect(t3.top("refine_filter")).toBe("recoverable");
    const rf = t3.answers.refine_filter as Extract<Answer, { kind: "choice" }>;
    expect(Math.min(rf.confidence, 0.8)).toBeGreaterThanOrEqual(0.75);

    const t4 = await ask("What should I do?", "All customers.");
    expect(t4.top("turn_type")).toBe("new_topic");
    expect(t4.top("ws.root")).toBe("action");
    expect(t4.top("show_actions")).toBe(true);
  });

  it("covers the other golden intents", async () => {
    const g05 = await ask("Compare this quarter with last quarter.", "A summary.");
    expect(g05.top("ws.root")).toBe("comparison");
    expect(g05.top("ws.comparison")).toBe("period_vs_period");

    for (const intent of ["hello", "asdf", "Show payroll."]) {
      expect((await ask(intent, "A summary.")).top("turn_type"), intent).toBe("unclear");
    }

    const g11 = await ask("look into customers and revenue", "A summary.");
    const root = g11.answers["ws.root"] as Extract<Answer, { kind: "choice" }>;
    expect(root.probabilities.investigation).toBeCloseTo(root.probabilities.customers ?? 0, 5);
  });

  it("does not refine when there is no current workspace", async () => {
    expect((await ask("Only show the top 5 customers")).top("turn_type")).toBe("new_topic");
  });

  it("answers pruned tree questions over the remaining options only", async () => {
    const root = questions.find((q) => q.id === "ws.root");
    if (root?.kind !== "choice") throw new Error("missing ws.root");
    const { customers: _c, ...options } = root.options;
    const answers = await createRulesProvider().evaluate({
      state: state("Show me the customers."),
      specs: [{ ...root, options }],
    });
    const a = answers["ws.root"] as Extract<Answer, { kind: "choice" }>;
    expect(Object.keys(a.probabilities)).not.toContain("customers");
  });
});
