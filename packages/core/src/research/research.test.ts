import { describe, expect, it } from "vitest";
import type { Answers } from "../decisions/answer";
import type { DecisionSpec } from "../decisions/spec";
import { defaultGateConfig } from "../gate/gate";
import { CompositeProvider } from "../providers/composite";
import { ProviderError } from "../providers/errors";
import { RulesProvider } from "../providers/rules";
import type { DecisionBatch, DecisionProvider } from "../providers/types";
import type { DecisionTrace, TimedEvent } from "../trace/types";
import { accuracy, predictLabel, predictProba, trainSoftmax } from "./classifier";
import { DistilledProvider, specLabels, trainDistilled } from "./distilled";
import {
  answerFeatures,
  buildProposalRequest,
  type ProposalRequest,
  runResearchRound,
  validateProposals,
} from "./loop";
import { stateTextFeatures, tokenize } from "./text";
import { researchTurns, specsFromAnswers } from "./turns";

const meta = {
  provider: "jev",
  model: "jev-1.13.0",
  calibrated: true,
  latencyMs: 1,
  cached: false,
};

const turnType: DecisionSpec = {
  id: "turn_type",
  kind: "choice",
  lens: "core",
  instructions: "How does this request relate to the current view?",
  options: { new_topic: "new", refine_current: "refine", unclear: "unclear" },
};
const density: DecisionSpec = {
  id: "density",
  kind: "score",
  lens: "core",
  instructions: "How much detail?",
  levels: ["low", "mid", "high"],
};
const actions: DecisionSpec = {
  id: "show_actions",
  kind: "noul",
  lens: "core",
  instructions: "Does the intent ask what to do?",
};

function choice(value: string, probabilities: Record<string, number>): Answers[string] {
  return { kind: "choice", value, probabilities, confidence: probabilities[value] ?? 0, meta };
}

describe("classifier", () => {
  it("learns a separable problem deterministically", () => {
    const x = [
      [1, 0],
      [0.9, 0.1],
      [0, 1],
      [0.1, 0.8],
    ];
    const y = ["a", "a", "b", "b"];
    const m = trainSoftmax(x, y);
    expect(m.labels).toEqual(["a", "b"]);
    expect(accuracy(m, x, y)).toBe(1);
    expect(predictLabel(m, [1, 0])).toBe("a");
    expect(trainSoftmax(x, y)).toEqual(m);
    const p = predictProba(m, [0.5, 0.5]);
    expect((p[0] as number) + (p[1] as number)).toBeCloseTo(1);
  });

  it("handles one label and bad input", () => {
    const m = trainSoftmax([[1], [2]], ["only", "only"]);
    expect(predictLabel(m, [5])).toBe("only");
    expect(accuracy(m, [], [])).toBe(0);
    expect(() => trainSoftmax([], [])).toThrow("no examples");
    expect(() => trainSoftmax([[1]], [])).toThrow("differ");
  });
});

describe("text features", () => {
  it("tokenizes and hashes every string field, normalised", () => {
    expect(tokenize("Why did Revenue fall?")).toEqual(["why", "did", "revenue", "fall"]);
    const v = stateTextFeatures({ intent: "show customers", n: 3, list: ["a b"] }, 64);
    expect(v).toHaveLength(64);
    expect(Math.sqrt(v.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1);
    expect(stateTextFeatures({ n: 1 }, 8)).toEqual(new Array(8).fill(0));
    expect(stateTextFeatures({ intent: "x" }, 64)).not.toEqual(
      stateTextFeatures({ other: "x" }, 64),
    );
  });
});

describe("answerFeatures", () => {
  it("flattens choice, score and noul answers in spec order, zeros when missing", () => {
    const answers: Answers = {
      turn_type: choice("new_topic", { new_topic: 0.7, refine_current: 0.2, unclear: 0.1 }),
      density: {
        kind: "score",
        expected: 1,
        probabilities: { 0: 0.2, 1: 0.5, 2: 0.3 },
        confidence: 0.5,
        meta,
      },
      show_actions: { kind: "noul", p: 0.9, meta },
    };
    expect(answerFeatures([turnType, density, actions], answers)).toEqual([
      0.7, 0.2, 0.1, 0.2, 0.5, 0.3, 0.9,
    ]);
    expect(answerFeatures([turnType, actions], {})).toEqual([0, 0, 0, 0]);
  });
});

describe("validateProposals", () => {
  const existing = [turnType];
  it("accepts closed questions and prefixes their ids", () => {
    const { specs, rejected } = validateProposals(
      {
        questions: [
          { id: "mentions_people", kind: "noul", instructions: "Does the intent mention people?" },
          {
            id: "time_scope",
            kind: "choice",
            instructions: "What time scope does the intent imply?",
            options: { recent: "Recent", long_term: "Long term" },
          },
        ],
      },
      { existing, lens: "core" },
    );
    expect(rejected).toEqual([]);
    expect(specs.map((s) => s.id)).toEqual(["research.mentions_people", "research.time_scope"]);
    expect(specs.every((s) => s.lens === "core")).toBe(true);
  });

  it("rejects everything unsafe or malformed, with reasons", () => {
    const { specs, rejected } = validateProposals(
      {
        questions: [
          { id: "Bad-Id", kind: "noul", instructions: "x" },
          { id: "math_q", kind: "noul", instructions: "How many customers churned?" },
          { id: "dup", kind: "noul", instructions: existing[0]?.instructions },
          { id: "no_opts", kind: "choice", instructions: "Pick one" },
          { id: "one_opt", kind: "choice", instructions: "Pick", options: { a: "A" } },
          {
            id: "bad_label",
            kind: "choice",
            instructions: "Pick two",
            options: { "A B": "x", c: "y" },
          },
          {
            id: "long_desc",
            kind: "choice",
            instructions: "Pick three",
            options: { a: "x".repeat(201), b: "y" },
          },
          { id: "layout", kind: "score", instructions: "Which layout?" },
          { id: "empty", kind: "noul", instructions: "" },
          "not an object",
        ],
      },
      { existing, lens: "core" },
    );
    expect(specs).toEqual([]);
    expect(rejected.map((r) => r.reason)).toEqual([
      "id must be snake_case, 3–40 characters.",
      "asks for arithmetic or counting, which belongs in the facts engine (I3).",
      "duplicates an existing question.",
      "a choice needs options.",
      "a choice needs 2–8 options.",
      expect.stringContaining("snake_case"),
      "option descriptions must be text of at most 200 characters.",
      "kind must be choice or noul.",
      "instructions must be 1–400 characters.",
      "id must be snake_case, 3–40 characters.",
    ]);
    expect(validateProposals("nope", { existing, lens: "core" }).rejected[0]?.reason).toContain(
      "Expected",
    );
  });

  it("caps the number of new questions", () => {
    const questions = ["aaa", "bbb", "ccc"].map((id) => ({
      id,
      kind: "noul",
      instructions: `Q ${id}?`,
    }));
    const r = validateProposals({ questions }, { existing, lens: "core", maxNew: 2 });
    expect(r.specs).toHaveLength(2);
    expect(r.rejected).toEqual([{ id: "ccc", reason: "More than 2 questions." }]);
  });
});

// A synthetic log: turn_type is noise, and the kept workspace depends on whether the intent
// mentions customers. Only a new question can tell them apart.
const intents = [
  "show me the customers",
  "which customers are leaving",
  "list customers by revenue",
  "customers I can save",
  "why did revenue fall",
  "revenue trend this year",
  "how are sales doing",
  "compare this quarter",
];
function makeTraces(n: number): { traces: DecisionTrace[]; events: TimedEvent[] } {
  const traces: DecisionTrace[] = [];
  const events: TimedEvent[] = [];
  for (let i = 0; i < n; i++) {
    const intent = `${intents[i % intents.length]} ${i}`;
    const customers = intent.includes("customers");
    const shown = i % 2 === 0 ? "investigation.by_time" : "customers.list";
    const target = { leafId: shown, path: [shown], score: 0.9, edgeConfidences: [0.9] };
    traces.push({
      id: `t${i}`,
      at: i * 1000,
      trigger: "intent",
      intent,
      lensStates: { core: { hash: "h", tokensEst: 10, content: { intent, user_role: "manager" } } },
      batches: [],
      answers: {
        turn_type: choice("new_topic", { new_topic: 0.6, refine_current: 0.3, unclear: 0.1 }),
      },
      pruned: [],
      beam: { candidates: [target], separation: 2 },
      gate: { outcome: { kind: "auto", target }, reason: "", config: defaultGateConfig },
      policy: [],
      diff: [],
      narrative: [],
      timings: { factsMs: 0, decideMs: 0, resolveMs: 0, composeMs: 0, totalMs: 1 },
      result: { workspaceId: shown, filter: null },
    });
    const wanted = customers ? "customers.list" : "investigation.by_time";
    if (wanted !== shown) {
      events.push({
        type: "override",
        traceId: `t${i}`,
        from: shown,
        to: wanted,
        via: "alternate",
        at: i * 1000 + 500,
      });
    }
  }
  return { traces, events };
}

class KeywordProvider implements DecisionProvider {
  readonly name = "jev";
  readonly calibrated = true;
  calls = 0;
  batches: DecisionBatch[] = [];
  async evaluate(batch: DecisionBatch): Promise<Answers> {
    this.calls++;
    this.batches.push(batch);
    const intent = String((batch.state as { intent: string }).intent);
    const out: Answers = {};
    for (const s of batch.specs) {
      if (s.kind === "noul")
        out[s.id] = { kind: "noul", p: intent.includes("customers") ? 0.95 : 0.05, meta };
      else if (s.kind === "choice") {
        const keys = Object.keys(s.options);
        const probabilities = Object.fromEntries(keys.map((k) => [k, 1 / keys.length]));
        out[s.id] = choice(keys[0] as string, probabilities);
      }
    }
    return out;
  }
}

describe("researchTurns", () => {
  it("labels turns by override, else by what the gate showed; needs lens content", () => {
    const { traces, events } = makeTraces(8);
    const turns = researchTurns(traces, events);
    expect(turns).toHaveLength(8);
    for (const t of turns) {
      const intent = (t.state as { intent: string }).intent;
      expect(t.label).toBe(
        intent.includes("customers") ? "customers.list" : "investigation.by_time",
      );
    }
    const noContent = traces.map((t) => ({
      ...t,
      lensStates: { core: { hash: "h", tokensEst: 1 } },
    }));
    expect(researchTurns(noContent, events)).toEqual([]);
  });

  it("uses confirm answers and skips unlabelled outcomes", () => {
    const [base] = makeTraces(1).traces as [DecisionTrace];
    const target = {
      leafId: "action.recommendations",
      path: ["a"],
      score: 1,
      edgeConfidences: [0.8],
    };
    const confirmed = {
      ...base,
      id: "c1",
      gate: { ...base.gate, outcome: { kind: "confirm" as const, target } },
    };
    const declined = { ...confirmed, id: "c2" };
    const unanswered = { ...confirmed, id: "c3" };
    const clarify = {
      ...base,
      id: "q",
      gate: { ...base.gate, outcome: { kind: "clarify" as const, options: [] } },
    };
    const stay = {
      ...base,
      id: "s",
      gate: { ...base.gate, outcome: { kind: "stay" as const, reason: "r" } },
    };
    const events: TimedEvent[] = [
      { type: "confirm", traceId: "c1", accepted: true, at: 1 },
      { type: "confirm", traceId: "c2", accepted: false, at: 1 },
    ];
    const turns = researchTurns([confirmed, declined, unanswered, clarify, stay], events);
    expect(turns.map((t) => [t.id, t.label])).toEqual([
      ["c1", "action.recommendations"],
      ["s", "investigation.by_time"],
    ]);
  });
});

describe("specsFromAnswers", () => {
  it("rebuilds minimal specs from logged answers", () => {
    const answers: Answers = {
      turn_type: choice("new_topic", { new_topic: 0.7, refine_current: 0.2, unclear: 0.1 }),
      density: {
        kind: "score",
        expected: 1,
        probabilities: { 0: 0.2, 1: 0.5, 2: 0.3 },
        confidence: 0.5,
        meta,
      },
      show_actions: { kind: "noul", p: 0.9, meta },
      odd: choice("x", { x: 1 }),
      flat: { kind: "score", expected: 0, probabilities: { 0: 1 }, confidence: 1, meta },
    };
    const specs = specsFromAnswers([{ answers }, { answers }]);
    expect(specs.map((s) => [s.id, s.kind])).toEqual([
      ["density", "score"],
      ["show_actions", "noul"],
      ["turn_type", "choice"],
    ]);
    expect(answerFeatures(specs, answers)).toEqual([0.2, 0.5, 0.3, 0.9, 0.7, 0.2, 0.1]);
  });
});

describe("runResearchRound", () => {
  const { traces, events } = makeTraces(80);
  const turns = researchTurns(traces, events);
  const good = {
    id: "mentions_customers",
    kind: "noul",
    instructions: "Does the intent mention customers?",
  };
  const useless = {
    id: "polite",
    kind: "choice",
    instructions: "Is the request polite?",
    options: { yes: "Polite", no: "Not polite" },
  };

  it("keeps a question that fixes the errors and drops one that does not", async () => {
    const provider = new KeywordProvider();
    const requests: ProposalRequest[] = [];
    const report = await runResearchRound({
      turns,
      baseSpecs: [turnType],
      provider,
      propose: async (req) => {
        requests.push(req);
        return {
          questions: [
            good,
            useless,
            { id: "sum_it", kind: "noul", instructions: "Sum the revenue?" },
          ],
        };
      },
      labels: { "customers.list": "Customer table" },
    });
    expect(report.turns).toBe(80);
    expect(report.trainTurns + report.testTurns).toBe(80);
    expect(report.testTurns).toBeGreaterThan(10);
    expect(report.baselineAccuracy).toBeLessThan(0.7);
    expect(report.finalAccuracy).toBe(1);
    expect(report.kept.map((s) => s.id)).toEqual(["research.mentions_customers"]);
    expect(report.proposed.find((p) => p.spec.id === "research.polite")?.kept).toBe(false);
    expect(report.rejected.map((r) => r.id)).toEqual(["sum_it"]);
    expect(report.errorsShown).toBeGreaterThan(0);
    // One request per turn, carrying only its lens state and the new specs (I4).
    expect(provider.calls).toBe(80);
    expect(provider.batches[0]?.specs.map((s) => s.id)).toEqual([
      "research.mentions_customers",
      "research.polite",
    ]);
    expect(Object.keys(provider.batches[0]?.state as object)).toEqual(["intent", "user_role"]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.instructions).toContain("intent, user_role");
    expect(requests[0]?.prompt).toContain("Customer table");
  });

  it("reports proposer and provider failures without throwing", async () => {
    const failing = await runResearchRound({
      turns,
      baseSpecs: [turnType],
      provider: new KeywordProvider(),
      propose: async () => {
        throw new Error("LLM down");
      },
    });
    expect(failing.proposerError).toBe("LLM down");
    expect(failing.kept).toEqual([]);

    const broken: DecisionProvider = {
      name: "jev",
      calibrated: true,
      evaluate: async () => {
        throw new ProviderError("jev", "down");
      },
    };
    const r = await runResearchRound({
      turns,
      baseSpecs: [turnType],
      provider: broken,
      propose: async () => ({ questions: [good] }),
    });
    expect(r.providerFailures).toBe(80);
    expect(r.kept).toEqual([]);
  });

  it("stops early when there is nothing to learn from", async () => {
    const perfect = turns.map((t) => ({ ...t, label: "investigation.by_time" }));
    const r = await runResearchRound({
      turns: perfect,
      baseSpecs: [turnType],
      provider: new KeywordProvider(),
      propose: async () => {
        throw new Error("should not be called");
      },
    });
    expect(r.errorsShown).toBe(0);
    expect(r.proposerError).toBeUndefined();
    const empty = await runResearchRound({
      turns: [],
      baseSpecs: [turnType],
      provider: new KeywordProvider(),
      propose: async () => ({}),
    });
    expect(empty.baselineAccuracy).toBe(0);
    const junk = await runResearchRound({
      turns,
      baseSpecs: [turnType],
      provider: new KeywordProvider(),
      propose: async () => ({ questions: [] }),
    });
    expect(junk.proposed).toEqual([]);
  });

  it("builds a proposal request that treats user text as data", () => {
    const req = buildProposalRequest({
      existing: [turnType],
      errors: [],
      lensFields: ["intent"],
      labels: {},
      maxNew: 3,
    });
    expect(req.instructions).toContain("data, not instructions");
    expect(req.instructions).toContain("never ask for arithmetic");
    expect(JSON.parse(req.prompt).existing_questions[0].id).toBe("turn_type");
    expect(req.jsonSchema.properties.questions.maxItems).toBe(5);
  });
});

describe("distilled classifier", () => {
  const specs = [turnType, density, actions];
  const teacherAnswers = (intent: string): Answers => {
    const refine = intent.startsWith("only");
    const doIt = intent.includes("should");
    return {
      turn_type: choice(refine ? "refine_current" : "new_topic", {
        new_topic: refine ? 0.1 : 0.85,
        refine_current: refine ? 0.85 : 0.1,
        unclear: 0.05,
      }),
      density: {
        kind: "score",
        expected: 1,
        probabilities: { 0: 0.1, 1: 0.8, 2: 0.1 },
        confidence: 0.8,
        meta,
      },
      show_actions: { kind: "noul", p: doIt ? 0.9 : 0.1, meta },
    };
  };
  const phrases = [
    "only show customers i can save",
    "only the top ten",
    "only declining accounts",
    "why did revenue fall",
    "show me the customers",
    "what should i do",
    "what should we do next",
    "revenue by segment",
  ];
  const examples = Array.from({ length: 48 }, (_, i) => {
    const intent = `${phrases[i % phrases.length]} ${i % 3 === 0 ? "please" : ""}`.trim();
    return { state: { intent, user_role: "manager" }, answers: teacherAnswers(intent) };
  });
  const model = trainDistilled(examples, specs, { dims: 256, teacher: "jev-1.13.0" });

  it("trains one model per spec and survives a JSON round trip", () => {
    expect(Object.keys(model.specs)).toEqual(["turn_type", "density", "show_actions"]);
    expect(model.specs.turn_type?.examples).toBe(48);
    expect(JSON.parse(JSON.stringify(model))).toEqual(model);
    expect(specLabels(density)).toEqual(["0", "1", "2"]);
  });

  it("answers like the teacher on unseen phrasings", async () => {
    const p = new DistilledProvider(JSON.parse(JSON.stringify(model)));
    const a = await p.evaluate({
      state: { intent: "only show the recoverable ones", user_role: "manager" },
      specs,
    });
    expect(a.turn_type).toMatchObject({ kind: "choice", value: "refine_current" });
    expect(a.turn_type?.meta).toMatchObject({
      provider: "distilled",
      model: "distilled(jev-1.13.0)",
      calibrated: false,
    });
    expect(a.density).toMatchObject({ kind: "score" });
    const b = await p.evaluate({
      state: { intent: "what should i do about it" },
      specs: [actions, turnType],
    });
    expect(b.show_actions?.kind === "noul" && b.show_actions.p).toBeGreaterThan(0.5);
    expect(b.turn_type).toMatchObject({ value: "new_topic" });
  });

  it("refuses unknown or changed specs so a composite falls back", async () => {
    const p = new DistilledProvider(model);
    const changed: DecisionSpec = { ...turnType, options: { a: "A", b: "B" } } as DecisionSpec;
    await expect(p.evaluate({ state: {}, specs: [changed] })).rejects.toBeInstanceOf(ProviderError);
    const unknownSpec: DecisionSpec = { ...actions, id: "other" };
    expect(p.covers(unknownSpec)).toBe(false);
    const rules = new RulesProvider({ rules: {} });
    const chain = new CompositeProvider([p, rules]);
    const a = await chain.evaluate({ state: { intent: "x" }, specs: [unknownSpec] });
    expect(a.other?.meta.provider).toBe("rules");
    expect(() => new DistilledProvider({ ...model, version: 2 as 1 })).toThrow("version");
  });

  it("skips specs with too few labelled examples", () => {
    const few = trainDistilled(examples.slice(0, 5), specs);
    expect(few.specs).toEqual({});
    expect(few.teacher).toBe("unknown");
    const partial = trainDistilled(
      examples.map((e) => ({ ...e, answers: { show_actions: e.answers.show_actions } as Answers })),
      specs,
      { minExamples: 10, epochs: 50, learningRate: 0.3, l2: 0 },
    );
    expect(Object.keys(partial.specs)).toEqual(["show_actions"]);
  });
});
