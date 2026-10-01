import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultGateConfig } from "../gate/gate";
import { jsonlTraceStore, readTraceStore } from "../node/traces";
import type { FetchLike } from "../providers/remote";
import { batchingSink, httpTraceSend, redactTrace, type TraceBatch } from "./batching";
import { RingBufferSink } from "./sink";
import type { DecisionTrace } from "./types";

function trace(id: string, at = 0, intent = "i"): DecisionTrace {
  return {
    id,
    at,
    trigger: "intent",
    intent,
    lensStates: { core: { hash: "h", tokensEst: 3, content: { secret: "rows" } } },
    batches: [],
    answers: {},
    pruned: [],
    beam: { candidates: [], separation: 0 },
    gate: { outcome: { kind: "stay", reason: "r" }, reason: "", config: defaultGateConfig },
    policy: [],
    diff: [],
    narrative: [],
    timings: { factsMs: 0, decideMs: 0, resolveMs: 0, composeMs: 0, totalMs: 1 },
  } as DecisionTrace;
}

function manualTimer() {
  let fn: (() => void) | null = null;
  return {
    setTimer: (f: () => void) => {
      fn = f;
      return 1;
    },
    clearTimer: () => {
      fn = null;
    },
    fire: () => fn?.(),
    armed: () => fn !== null,
  };
}

describe("redactTrace", () => {
  it("keeps hashes and drops lens content", () => {
    const r = redactTrace(trace("a"));
    expect(r.lensStates).toEqual({ core: { hash: "h", tokensEst: 3 } });
    expect(JSON.stringify(r)).not.toContain("rows");
  });
});

describe("batchingSink", () => {
  it("sends after the delay, deduplicating rewritten traces", async () => {
    const sent: TraceBatch[] = [];
    const t = manualTimer();
    const sink = batchingSink({ send: (b) => void sent.push(b), clock: () => 42, ...t });
    sink.write(trace("a", 1, "first"));
    sink.write(trace("a", 1, "second"));
    sink.event({ type: "confirm", traceId: "a", accepted: true });
    expect(sink.pending()).toBe(2);
    expect(sent).toHaveLength(0);
    t.fire();
    await Promise.resolve();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.traces.map((x) => x.intent)).toEqual(["second"]);
    expect(sent[0]?.events).toEqual([{ type: "confirm", traceId: "a", accepted: true, at: 42 }]);
    expect(sent[0]?.traces[0]?.lensStates.core?.content).toBeUndefined();
    expect(sink.pending()).toBe(0);
  });

  it("flushes at maxBatch without waiting and clears the timer", () => {
    const sent: TraceBatch[] = [];
    const t = manualTimer();
    const sink = batchingSink({ send: (b) => void sent.push(b), maxBatch: 2, ...t });
    sink.write(trace("a"));
    expect(t.armed()).toBe(true);
    sink.write(trace("b"));
    expect(sent).toHaveLength(1);
    expect(t.armed()).toBe(false);
  });

  it("keeps lens content only when asked", async () => {
    const sent: TraceBatch[] = [];
    const sink = batchingSink({ send: (b) => void sent.push(b), keepLensContent: true });
    sink.write(trace("a"));
    await sink.flush();
    expect(sent[0]?.traces[0]?.lensStates.core?.content).toEqual({ secret: "rows" });
  });

  it("an empty flush sends nothing", async () => {
    const send = vi.fn();
    await batchingSink({ send }).flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("reports send failures, sync or async, without throwing", async () => {
    const errors: unknown[] = [];
    const t = manualTimer();
    const asyncSink = batchingSink({
      send: () => Promise.reject(new Error("down")),
      onError: (e) => errors.push(e),
      ...t,
    });
    asyncSink.write(trace("a"));
    await asyncSink.flush();
    const syncSink = batchingSink({
      send: () => {
        throw new Error("boom");
      },
      onError: (e) => errors.push(e),
      ...t,
    });
    syncSink.write(trace("b"));
    await syncSink.flush();
    expect(errors.map((e) => (e as Error).message)).toEqual(["down", "boom"]);
  });

  it("uses real timers by default", async () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn();
      const sink = batchingSink({ send, delayMs: 100 });
      sink.write(trace("a"));
      vi.advanceTimersByTime(99);
      expect(send).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(send).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("RingBufferSink forward", () => {
  it("forwards traces and events while keeping its own copy", () => {
    const sent: TraceBatch[] = [];
    const store = batchingSink({ send: (b) => void sent.push(b), maxBatch: 2 });
    const ring = new RingBufferSink({ forward: store });
    ring.write(trace("a"));
    ring.event({ type: "confirm", traceId: "a", accepted: false });
    expect(ring.traces()).toHaveLength(1);
    expect(sent[0]?.traces.map((t) => t.id)).toEqual(["a"]);
    expect(sent[0]?.events.map((e) => e.type)).toEqual(["confirm"]);
  });
});

describe("httpTraceSend", () => {
  it("POSTs the batch as JSON and rejects on HTTP errors", async () => {
    const calls: { url: string; body: string }[] = [];
    let status = 204;
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, body: init.body });
      return { ok: status < 300, status, json: async () => ({}) };
    };
    const send = httpTraceSend("/api/morph/traces", fetchImpl);
    const batch: TraceBatch = { version: 1, traces: [trace("a")], events: [] };
    await send(batch);
    expect(calls[0]?.url).toBe("/api/morph/traces");
    expect(JSON.parse(calls[0]?.body ?? "{}").traces[0].id).toBe("a");
    status = 500;
    await expect(send(batch)).rejects.toThrow("500");
  });

  it("uses the global fetch when none is given", () => {
    expect(() => httpTraceSend("/x")).not.toThrow();
  });
});

describe("jsonlTraceStore", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("appends one file per day and reads back the latest version of each trace", () => {
    dir = mkdtempSync(join(tmpdir(), "morph-traces-"));
    let now = Date.parse("2026-09-27T23:59:00Z");
    const store = jsonlTraceStore(join(dir, "nested"), { clock: () => now });
    store.append({ version: 1, traces: [trace("a", 1, "first")], events: [] });
    now = Date.parse("2026-09-28T00:01:00Z");
    store.append({
      version: 1,
      traces: [trace("a", 1, "second"), trace("b", 0)],
      events: [{ type: "override", traceId: "a", from: "x", to: "y", via: "undo", at: 5 }],
    });
    store.append({ version: 1, traces: [], events: [] });
    expect(readdirSync(join(dir, "nested")).sort()).toEqual([
      "traces-2026-09-27.jsonl",
      "traces-2026-09-28.jsonl",
    ]);
    const read = readTraceStore(join(dir, "nested"));
    expect(read.traces.map((t) => [t.id, t.intent])).toEqual([
      ["b", "i"],
      ["a", "second"],
    ]);
    expect(read.events).toHaveLength(1);
    expect(read.skipped).toBe(0);
    expect(JSON.stringify(read)).not.toContain("rows");
  });

  it("stores lens content when keepLensContent is set", () => {
    dir = mkdtempSync(join(tmpdir(), "morph-traces-"));
    jsonlTraceStore(dir, { keepLensContent: true }).append({
      version: 1,
      traces: [trace("a")],
      events: [],
    });
    expect(readTraceStore(dir).traces[0]?.lensStates.core?.content).toEqual({ secret: "rows" });
  });

  it("skips malformed lines and ignores other files", () => {
    dir = mkdtempSync(join(tmpdir(), "morph-traces-"));
    writeFileSync(join(dir, "traces-2026-01-01.jsonl"), 'not json\n{"kind":"nope"}\n\n');
    writeFileSync(join(dir, "notes.txt"), "hello");
    expect(readTraceStore(dir)).toEqual({ traces: [], events: [], skipped: 2 });
  });

  it("reads a missing directory as empty", () => {
    expect(readTraceStore(join(tmpdir(), "morph-missing-dir-xyz")).traces).toEqual([]);
  });
});
