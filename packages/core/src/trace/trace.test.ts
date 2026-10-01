import { describe, expect, it } from "vitest";
import { defaultGateConfig } from "../gate/gate";
import {
  calibrationTable,
  clarifyRate,
  fallbackRate,
  narrativeSummary,
  overrideRate,
  percentile,
  summarize,
  unwantedMorphRate,
} from "./metrics";
import { multiSink, RingBufferSink } from "./sink";
import type { DecisionTrace, TimedEvent } from "./types";

const cand = (conf: number) => ({ leafId: "x", path: ["x"], score: conf, edgeConfidences: [conf] });
function trace(
  id: string,
  at: number,
  kind: "auto" | "confirm" | "clarify" | "stay",
  opts: { conf?: number; fallback?: boolean; total?: number } = {},
): DecisionTrace {
  const outcome =
    kind === "auto" || kind === "confirm"
      ? { kind, target: cand(opts.conf ?? 0.9) }
      : kind === "clarify"
        ? { kind, options: [] }
        : { kind, reason: "r" };
  return {
    id,
    at,
    trigger: "intent",
    intent: "i",
    lensStates: {},
    batches: opts.fallback
      ? [
          {
            provider: "rules",
            model: null,
            specIds: [],
            latencyMs: 1,
            cached: [],
            fallbackFrom: "jev",
          },
        ]
      : [{ provider: "jev", model: "jev-1.13.0", specIds: [], latencyMs: 1, cached: [] }],
    answers: {},
    pruned: [],
    beam: { candidates: [], separation: 0 },
    gate: { outcome, reason: "", config: defaultGateConfig } as DecisionTrace["gate"],
    policy: [],
    diff: [],
    narrative: [],
    timings: { factsMs: 0, decideMs: 0, resolveMs: 0, composeMs: 0, totalMs: opts.total ?? 100 },
  };
}

/** Synthetic log: 4 autos (one undone within 10 s, one overridden after 30 s), 1 confirm, 1 clarify, 1 stay. */
const traces = [
  trace("t1", 0, "auto", { conf: 0.95, total: 50 }),
  trace("t2", 20_000, "auto", { conf: 0.92, total: 80 }),
  trace("t3", 40_000, "auto", { conf: 0.81, fallback: true, total: 120 }),
  trace("t4", 60_000, "auto", { conf: 0.85, total: 300 }),
  trace("t5", 80_000, "confirm", { conf: 0.72, total: 90 }),
  trace("t6", 100_000, "clarify", { total: 60 }),
  trace("t7", 120_000, "stay", { fallback: true, total: 70 }),
];
const events: TimedEvent[] = [
  { type: "override", traceId: "t2", from: "a", to: "b", via: "undo", at: 25_000 },
  { type: "override", traceId: "t3", from: "a", to: "b", via: "alternate", at: 70_000 },
  { type: "confirm", traceId: "t5", accepted: true, at: 81_000 },
];

describe("metrics on a synthetic event log", () => {
  it("override rate = overrides / traces", () => {
    expect(overrideRate(traces, events)).toBeCloseTo(2 / 7);
    expect(overrideRate([], [])).toBe(0);
  });
  it("unwanted morph rate counts autos overridden within 10 s", () => {
    expect(unwantedMorphRate(traces, events)).toBeCloseTo(1 / 4);
  });
  it("clarify and fallback rates", () => {
    expect(clarifyRate(traces)).toBeCloseTo(1 / 7);
    expect(fallbackRate(traces)).toBeCloseTo(2 / 7);
  });
  it("calibration table buckets by 0.1", () => {
    expect(calibrationTable(traces, events)).toEqual([
      { bucket: 0.7, count: 1, accepted: 1 },
      { bucket: 0.8, count: 2, accepted: 1 },
      { bucket: 0.9, count: 2, accepted: 0.5 },
    ]);
  });
  it("p50/p95 totalMs", () => {
    expect(percentile([], 50)).toBe(0);
    const s = summarize(traces, events);
    expect(s.p50TotalMs).toBe(80);
    expect(s.p95TotalMs).toBe(300);
    expect(s.traces).toBe(7);
  });
});

describe("RingBufferSink", () => {
  it("keeps the last N traces, replaces by id, and exports JSON", () => {
    const sink = new RingBufferSink({ capacity: 2, clock: () => 5 });
    let notified = 0;
    const off = sink.subscribe(() => notified++);
    sink.write(trace("a", 0, "stay"));
    sink.write(trace("b", 0, "stay"));
    sink.write(trace("c", 0, "stay"));
    sink.write({ ...trace("c", 0, "stay"), intent: "updated" });
    expect(sink.traces().map((t) => t.id)).toEqual(["b", "c"]);
    expect(sink.get("c")?.intent).toBe("updated");
    expect(sink.latest()?.id).toBe("c");
    sink.event({ type: "confirm", traceId: "c", accepted: false });
    expect(sink.events()[0]?.at).toBe(5);
    expect(JSON.parse(sink.exportJSON())).toMatchObject({
      version: 1,
      traces: [{ id: "b" }, { id: "c" }],
    });
    off();
    sink.write(trace("d", 0, "stay"));
    expect(notified).toBe(5);
    for (let i = 0; i < 20; i++) sink.event({ type: "confirm", traceId: "x", accepted: true });
    expect(sink.events()).toHaveLength(10);
  });
  it("multiSink fans out", () => {
    const a = new RingBufferSink();
    const b = new RingBufferSink();
    const m = multiSink(a, b);
    m.write(trace("x", 0, "stay"));
    m.event({ type: "task_complete", traceId: "x", task: "t" });
    expect(a.traces()).toHaveLength(1);
    expect(b.events()).toHaveLength(1);
  });
});

describe("narrativeSummary", () => {
  const withNarrative = (id: string, narrative: DecisionTrace["narrative"]) => ({
    ...trace(id, 0, "auto"),
    narrative,
  });
  it("is all zeros when the narrative tier did nothing", () => {
    expect(narrativeSummary([trace("a", 0, "auto")])).toEqual({
      slots: 0,
      aiShare: 0,
      claimsIn: 0,
      claimsKept: 0,
      keptShare: 0,
      errorShare: 0,
    });
    expect(summarize([trace("a", 0, "auto")], []).narrative.slots).toBe(0);
  });

  it("counts slots that showed model claims, claims kept, and slots where the provider failed", () => {
    const s = narrativeSummary([
      withNarrative("a", [
        {
          slotId: "s1",
          claimsIn: 4,
          claimsKept: 3,
          dropped: ["unsupported number(s): 9"],
          source: "ai",
        },
        {
          slotId: "s2",
          claimsIn: 0,
          claimsKept: 0,
          dropped: ["provider error (429)"],
          source: "facts",
        },
      ]),
      withNarrative("b", [
        { slotId: "s3", claimsIn: 2, claimsKept: 0, dropped: ["x", "y"], source: "facts" },
        {
          slotId: "s4",
          claimsIn: 0,
          claimsKept: 0,
          dropped: ["request failed (503)"],
          source: "facts",
        },
      ]),
    ]);
    expect(s).toEqual({
      slots: 4,
      aiShare: 0.25,
      claimsIn: 6,
      claimsKept: 3,
      keptShare: 0.5,
      errorShare: 0.5,
    });
  });

  it("does not count a model that answered with nothing as a failure", () => {
    const s = narrativeSummary([
      withNarrative("a", [
        {
          slotId: "s",
          claimsIn: 0,
          claimsKept: 0,
          dropped: ["model returned no claims"],
          source: "facts",
        },
      ]),
    ]);
    expect(s.errorShare).toBe(0);
  });
});
