import type { TraceBatch } from "@morph/core";
import { describe, expect, it } from "vitest";
import { createTracesHandler, MAX_TRACE_BODY_BYTES, traceStorageEnabled } from "./traces";

const trace = {
  id: "t1",
  at: 1,
  trigger: "intent",
  intent: "Why did revenue fall?",
  lensStates: { core: { hash: "abc", tokensEst: 40 } },
  batches: [],
  answers: {},
  pruned: [],
  beam: { candidates: [], separation: 0 },
  gate: { outcome: { kind: "stay", reason: "r" }, reason: "", config: {} },
  policy: [],
  diff: [],
  narrative: [],
  timings: { factsMs: 0, decideMs: 0, resolveMs: 0, composeMs: 0, totalMs: 12 },
};
const batch = {
  version: 1,
  traces: [trace],
  events: [{ type: "confirm", traceId: "t1", accepted: true, at: 5 }],
};

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/morph/traces", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function setup(opts: { store?: boolean; allow?: boolean; failStore?: boolean } = {}) {
  const saved: TraceBatch[] = [];
  const logs: string[] = [];
  const handler = createTracesHandler({
    store:
      opts.store === false
        ? null
        : {
            append: (b) => {
              if (opts.failStore) throw new Error("disk full");
              saved.push(b);
            },
          },
    limiter: { take: () => opts.allow ?? true },
    log: (m) => logs.push(m),
  });
  return { handler, saved, logs };
}

describe("POST /api/morph/traces", () => {
  it("stores a valid batch and returns 204", async () => {
    const { handler, saved } = setup();
    const res = await handler(post(batch));
    expect(res.status).toBe(204);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.traces[0]?.id).toBe("t1");
    expect(saved[0]?.events[0]).toEqual({ type: "confirm", traceId: "t1", accepted: true, at: 5 });
  });

  it("accepts and drops batches when storage is off", async () => {
    const { handler, saved } = setup({ store: false });
    expect((await handler(post(batch))).status).toBe(204);
    expect(saved).toHaveLength(0);
  });

  it("rejects bad JSON, bad shapes and unknown event types", async () => {
    const { handler, saved } = setup();
    expect((await handler(post("{"))).status).toBe(400);
    expect((await handler(post({ version: 2, traces: [], events: [] }))).status).toBe(400);
    expect((await handler(post({ ...batch, traces: [{ id: "x" }] }))).status).toBe(400);
    expect(
      (await handler(post({ ...batch, events: [{ type: "hack", traceId: "t1", at: 1 }] }))).status,
    ).toBe(400);
    expect(saved).toHaveLength(0);
  });

  it("rejects oversized bodies, by header and by content", async () => {
    const { handler } = setup();
    const big = String(MAX_TRACE_BODY_BYTES + 1);
    expect((await handler(post(batch, { "content-length": big }))).status).toBe(413);
    const huge = { ...batch, traces: [{ ...trace, intent: "x".repeat(MAX_TRACE_BODY_BYTES) }] };
    expect((await handler(post(huge))).status).toBe(413);
  });

  it("rate limits", async () => {
    const { handler } = setup({ allow: false });
    expect((await handler(post(batch))).status).toBe(429);
  });

  it("returns 503 and logs when the store fails", async () => {
    const { handler, logs } = setup({ failStore: true });
    const res = await handler(post(batch));
    expect(res.status).toBe(503);
    expect(logs).toEqual(["disk full"]);
  });

  it("is enabled only when MORPH_TRACE_DIR is set", () => {
    expect(traceStorageEnabled({})).toBe(false);
    expect(traceStorageEnabled({ MORPH_TRACE_DIR: " " })).toBe(false);
    expect(traceStorageEnabled({ MORPH_TRACE_DIR: ".morph/traces" })).toBe(true);
  });
});
