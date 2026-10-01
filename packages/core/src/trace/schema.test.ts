import { describe, expect, it } from "vitest";
import { makeCtx, registry, rulesProvider, specs, templates, tree } from "../__fixtures__/miniApp";
import { createMorph } from "../runtime/createMorph";
import { DecisionTraceSchema, isBoundedJson, TimedEventSchema, TraceBatchSchema } from "./schema";
import type { DecisionTrace } from "./types";

/** Real traces from a running morph, as they look after the JSON round trip to the route. */
async function realTraces(): Promise<DecisionTrace[]> {
  let now = 1_000_000;
  let n = 0;
  const morph = createMorph({
    registry,
    templates,
    tree,
    specs,
    provider: rulesProvider(),
    clock: () => now,
    idGen: () => `t${n++}`,
    traceFull: true,
  });
  morph.setState(morph.composeLeaf("overview.default", makeCtx("")));
  const out: DecisionTrace[] = [];
  for (const intent of ["Why did revenue fall?", "Only show customers I can save.", "hello"]) {
    now += 5_000;
    const s = morph.getState();
    const ctx = makeCtx(intent, {
      ui: {
        workspaceId: s?.workspaceId ?? null,
        componentIds: [],
        lastMorphAt: null,
        activeFilter: s?.filter ?? null,
      },
    });
    out.push((await morph.resolve(ctx)).trace);
  }
  return out.map((t) => JSON.parse(JSON.stringify(t)) as DecisionTrace);
}

/** Whether the trace still parses after setting one dotted path (on a deep copy) to `value`. */
function parsesWith(t: DecisionTrace, path: string, value: unknown): boolean {
  const copy = JSON.parse(JSON.stringify(t)) as Record<string, unknown>;
  const keys = path.split(".");
  const last = keys.pop() as string;
  let node = copy;
  for (const k of keys) node = node[k] as Record<string, unknown>;
  node[last] = value;
  return DecisionTraceSchema.safeParse(copy).success;
}

describe("DecisionTraceSchema", () => {
  it("accepts real traces, and restores the critical threshold that JSON turns into null", async () => {
    const traces = await realTraces();
    expect(traces.length).toBe(3);
    for (const t of traces) {
      const r = DecisionTraceSchema.safeParse(t);
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
      if (r.success)
        expect(r.data.gate.config.autoThreshold.critical).toBe(Number.POSITIVE_INFINITY);
    }
    // The gate recorded no risk before step 8, and lens content is allowed (traceFull).
    expect(JSON.stringify(traces)).toContain('"content"');
  });

  it("rejects unknown keys at every level", async () => {
    const [t] = await realTraces();
    const trace = t as DecisionTrace;
    const q = Object.keys(trace.answers)[0] as string;
    expect(parsesWith(trace, "extra", "payload")).toBe(false);
    expect(parsesWith(trace, "gate.extra", 1)).toBe(false);
    expect(parsesWith(trace, "timings.extra", 1)).toBe(false);
    expect(parsesWith(trace, `answers.${q}.meta.extra`, true)).toBe(false);
    expect(parsesWith(trace, "result.extra", true)).toBe(false);
    // A harmless change to a known field is still accepted.
    expect(parsesWith(trace, "intent", "a different intent")).toBe(true);
  });

  it("rejects out-of-range and oversized values", async () => {
    const [t] = await realTraces();
    const trace = t as DecisionTrace;
    const q = Object.keys(trace.answers)[0] as string;
    expect(parsesWith(trace, `answers.${q}.confidence`, 1.5)).toBe(false);
    expect(parsesWith(trace, "trigger", "hack")).toBe(false);
    expect(parsesWith(trace, "intent", "x".repeat(2_001))).toBe(false);
    expect(parsesWith(trace, "id", "")).toBe(false);
    expect(parsesWith(trace, "at", Number.NaN)).toBe(false);
    expect(parsesWith(trace, "batches", Array(21).fill(trace.batches[0]))).toBe(false);
    const many = Object.fromEntries(
      Array.from({ length: 65 }, (_, i) => [`q${i}`, trace.answers[q]]),
    );
    expect(parsesWith(trace, "answers", many)).toBe(false);
  });

  it("accepts narrative records with a source, and rejects an unknown one", async () => {
    const [t] = await realTraces();
    const trace = t as DecisionTrace;
    const record = { slotId: "s", claimsIn: 2, claimsKept: 1, dropped: ["r"] };
    expect(parsesWith(trace, "narrative", [{ ...record, source: "ai" }])).toBe(true);
    expect(parsesWith(trace, "narrative", [record])).toBe(true);
    expect(parsesWith(trace, "narrative", [{ ...record, source: "robot" }])).toBe(false);
    expect(parsesWith(trace, "narrative", [{ ...record, extra: 1 }])).toBe(false);
    expect(parsesWith(trace, "narrative", [{ ...record, dropped: Array(21).fill("r") }])).toBe(
      false,
    );
  });

  it("bounds lens content in depth, size and string length", () => {
    expect(isBoundedJson({ intent: "why", list: [1, 2, { a: "b" }] })).toBe(true);
    let deep: unknown = "x";
    for (let i = 0; i < 20; i++) deep = [deep];
    expect(isBoundedJson(deep)).toBe(false);
    expect(isBoundedJson(Array.from({ length: 2_001 }, () => 1))).toBe(false);
    expect(isBoundedJson("x".repeat(2_001))).toBe(false);
    expect(isBoundedJson(Number.NaN)).toBe(false);
    expect(isBoundedJson(undefined)).toBe(false);
    // 100k levels deep must be refused without blowing the stack.
    let huge: unknown = [];
    for (let i = 0; i < 100_000; i++) huge = [huge];
    expect(isBoundedJson(huge)).toBe(false);
  });
});

describe("TimedEventSchema and TraceBatchSchema", () => {
  it("accepts the four event types and rejects anything else", () => {
    const ok = [
      { type: "override", traceId: "a", from: "x", to: "y", via: "undo", at: 1 },
      { type: "confirm", traceId: "a", accepted: false, at: 1 },
      { type: "task_complete", traceId: "a", task: "t", at: 1 },
      { type: "render_error", traceId: "a", componentId: "c", error: "e", at: 1 },
    ];
    for (const e of ok) expect(TimedEventSchema.safeParse(e).success).toBe(true);
    expect(TimedEventSchema.safeParse({ type: "hack", traceId: "a", at: 1 }).success).toBe(false);
    expect(TimedEventSchema.safeParse({ ...ok[1], extra: 1 }).success).toBe(false);
    expect(TimedEventSchema.safeParse({ ...ok[0], via: "other" }).success).toBe(false);
  });

  it("caps traces and events per batch and requires version 1", async () => {
    const [t] = await realTraces();
    const parse = (b: unknown) => TraceBatchSchema.safeParse(b).success;
    expect(parse({ version: 1, traces: [t], events: [] })).toBe(true);
    expect(parse({ version: 2, traces: [], events: [] })).toBe(false);
    expect(parse({ version: 1, traces: Array(51).fill(t), events: [] })).toBe(false);
    const e = { type: "confirm", traceId: "a", accepted: true, at: 1 };
    expect(parse({ version: 1, traces: [], events: Array(201).fill(e) })).toBe(false);
    expect(parse({ version: 1, traces: [], events: [], extra: 1 })).toBe(false);
  });
});
