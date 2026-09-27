import { describe, expect, it } from "vitest";
import type { RiskLevel } from "../context/types";
import type { DecisionTrace, TimedEvent } from "../trace/types";
import { calibrateGate, traceModel } from "./calibrate";
import { defaultGateConfig } from "./gate";

const target = { leafId: "x", path: ["x"], score: 1, edgeConfidences: [1] };

function trace(
  id: string,
  opts: {
    kind?: "auto" | "confirm" | "clarify";
    risk?: RiskLevel;
    confidence?: number;
    model?: string | null;
    provider?: string;
    at?: number;
  } = {},
): DecisionTrace {
  const kind = opts.kind ?? "auto";
  const outcome =
    kind === "clarify"
      ? { kind, options: [] }
      : ({ kind, target } as { kind: "auto"; target: typeof target });
  const gate: DecisionTrace["gate"] = { outcome, reason: "", config: defaultGateConfig };
  if (kind !== "clarify") {
    gate.risk = opts.risk ?? "low";
    gate.confidence = opts.confidence ?? 0.9;
  }
  return {
    id,
    at: opts.at ?? 0,
    trigger: "intent",
    intent: "i",
    lensStates: {},
    batches: [
      {
        provider: opts.provider ?? "jev",
        model: opts.model === undefined ? "jev-1.13.0" : opts.model,
        specIds: [],
        latencyMs: 1,
        cached: [],
      },
    ],
    answers: {},
    pruned: [],
    beam: { candidates: [], separation: 0 },
    gate,
    policy: [],
    diff: [],
    narrative: [],
    timings: { factsMs: 0, decideMs: 0, resolveMs: 0, composeMs: 0, totalMs: 1 },
  };
}

const undo = (traceId: string, at = 1000): TimedEvent => ({
  type: "override",
  traceId,
  from: "a",
  to: "b",
  via: "undo",
  at,
});

/** `n` auto outcomes at `confidence`; the first `bad` of them are undone within 10 s. */
function autos(
  prefix: string,
  n: number,
  confidence: number,
  bad: number,
  risk: RiskLevel = "low",
) {
  const traces = Array.from({ length: n }, (_, i) => trace(`${prefix}${i}`, { confidence, risk }));
  const events = traces.slice(0, bad).map((t) => undo(t.id));
  return { traces, events };
}

describe("traceModel", () => {
  it("names the versioned model, else the provider, ignoring failed batches", () => {
    expect(traceModel(trace("a"))).toBe("jev-1.13.0");
    expect(traceModel(trace("b", { model: null, provider: "rules" }))).toBe("rules");
    const t = trace("c");
    t.batches[0] = { ...(t.batches[0] as DecisionTrace["batches"][number]), error: "down" };
    expect(traceModel(t)).toBe("none");
  });
});

describe("calibrateGate", () => {
  it("keeps the current thresholds when there is not enough data", () => {
    const { traces, events } = autos("t", 5, 0.9, 0);
    const [m] = calibrateGate(traces, events);
    expect(m?.model).toBe("jev-1.13.0");
    expect(m?.risks[0]).toMatchObject({ risk: "low", samples: 5, suggested: 0.75 });
    expect(m?.risks[0]?.note).toContain("Not enough data");
    expect(m?.gate.autoThreshold).toEqual(defaultGateConfig.autoThreshold);
  });

  it("lowers a threshold when outcomes below it were kept", () => {
    // 40 confirms at 0.65, all accepted, and 40 autos at 0.9 with 1 undo.
    const confirms = Array.from({ length: 40 }, (_, i) =>
      trace(`c${i}`, { kind: "confirm", confidence: 0.65 }),
    );
    const accepted: TimedEvent[] = confirms.map((t) => ({
      type: "confirm",
      traceId: t.id,
      accepted: true,
      at: 5,
    }));
    const a = autos("a", 40, 0.9, 1);
    const [m] = calibrateGate([...confirms, ...a.traces], [...accepted, ...a.events]);
    const low = m?.risks[0];
    expect(low?.suggested).toBe(0.65);
    expect(low?.samplesAbove).toBe(80);
    expect(low?.note).toMatch(/^Lower to 0.65/);
  });

  it("raises a threshold when low-confidence morphs get undone", () => {
    const risky = autos("r", 40, 0.78, 20); // half undone
    const good = autos("g", 40, 0.9, 0);
    const [m] = calibrateGate([...risky.traces, ...good.traces], [...risky.events, ...good.events]);
    expect(m?.risks[0]?.suggested).toBe(0.79);
    expect(m?.risks[0]?.acceptedAbove).toBe(1);
  });

  it("keeps the threshold and says so when no threshold reaches the target", () => {
    const { traces, events } = autos("t", 40, 0.9, 20);
    const [m] = calibrateGate(traces, events);
    expect(m?.risks[0]?.suggested).toBe(0.75);
    expect(m?.risks[0]?.note).toContain("reaches the 90% target");
  });

  it("ignores overrides outside the window, clarify outcomes and unanswered confirms", () => {
    const { traces } = autos("t", 30, 0.8, 0);
    const late = traces.map((t) => undo(t.id, 60_000));
    const extra = [
      trace("q", { kind: "clarify" }),
      trace("p", { kind: "confirm", confidence: 0.6 }),
    ];
    const [m] = calibrateGate([...traces, ...extra], late);
    expect(m?.risks[0]?.samples).toBe(30);
    expect(m?.risks[0]?.suggested).toBe(0.8);
  });

  it("calibrates each model separately and keeps risk levels ordered", () => {
    const jevLow = autos("l", 30, 0.9, 0, "low");
    const jevMed = autos("m", 30, 0.7, 0, "medium");
    const rules = Array.from({ length: 3 }, (_, i) =>
      trace(`r${i}`, { model: null, provider: "rules" }),
    );
    const out = calibrateGate([...jevLow.traces, ...jevMed.traces, ...rules], []);
    expect(out.map((m) => m.model)).toEqual(["jev-1.13.0", "rules"]);
    const jev = out[0];
    expect(jev?.risks.map((r) => r.suggested)).toEqual([0.9, 0.9, 0.95]);
    expect(jev?.risks[1]?.note).toContain("Raised to 0.9");
    expect(jev?.gate.autoThreshold.critical).toBe(Number.POSITIVE_INFINITY);
  });

  it("honours custom targets, sample sizes and base config", () => {
    const { traces, events } = autos("t", 10, 0.7, 1);
    const base = {
      ...defaultGateConfig,
      autoThreshold: { ...defaultGateConfig.autoThreshold, low: 0.8 },
    };
    const [m] = calibrateGate(traces, events, { base, minSamples: 10, targets: { low: 0.85 } });
    expect(m?.risks[0]).toMatchObject({ current: 0.8, suggested: 0.7, acceptedAbove: 0.9 });
  });
});
