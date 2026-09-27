import type { DecisionTrace, TimedEvent, TraceBatch } from "@morph/core";
import type { TraceStore } from "@morph/core/node";
import { z } from "zod";
import { errorResponse } from "./decide";
import { clientIp, type RateLimiter } from "./rate-limit";

// POST /api/morph/traces: stores trace batches from the browser's batching sink
// (docs/backlog.md#trace-storage, ADR 0007). Without MORPH_TRACE_DIR the route accepts and drops
// them, so the demo behaves the same with or without storage.

export const MAX_TRACE_BODY_BYTES = 512 * 1024;
export const MAX_TRACES_PER_BATCH = 50;
export const MAX_EVENTS_PER_BATCH = 200;

const Id = z.string().min(1).max(200);

const TraceSchema = z.looseObject({
  id: Id,
  at: z.number().finite(),
  trigger: z.string().max(40),
  intent: z.string().max(2000),
  lensStates: z.record(z.string(), z.looseObject({ hash: z.string(), tokensEst: z.number() })),
  batches: z.array(z.unknown()).max(20),
  gate: z.looseObject({ outcome: z.looseObject({ kind: z.string() }) }),
  timings: z.looseObject({ totalMs: z.number() }),
});

const EventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("override"),
    traceId: Id,
    from: Id,
    to: Id,
    via: z.enum(["alternate", "undo", "clarify"]),
    at: z.number(),
  }),
  z.object({ type: z.literal("confirm"), traceId: Id, accepted: z.boolean(), at: z.number() }),
  z.object({ type: z.literal("task_complete"), traceId: Id, task: Id, at: z.number() }),
  z.object({
    type: z.literal("render_error"),
    traceId: Id,
    componentId: Id,
    error: z.string().max(2000),
    at: z.number(),
  }),
]);

const BatchSchema = z.object({
  version: z.literal(1),
  traces: z.array(TraceSchema).max(MAX_TRACES_PER_BATCH),
  events: z.array(EventSchema).max(MAX_EVENTS_PER_BATCH),
});

export interface TracesHandlerOptions {
  /** null when storage is off: batches are validated and dropped. */
  store: TraceStore | null;
  limiter: RateLimiter;
  log?: (message: string) => void;
}

export function createTracesHandler(opts: TracesHandlerOptions) {
  const log = opts.log ?? ((m: string) => console.error(`[morph/traces] ${m}`));
  return async function traces(req: Request): Promise<Response> {
    if (!(await opts.limiter.take(clientIp(req.headers)))) {
      return errorResponse(429, "rate_limited", "Too many requests. Try again in a moment.");
    }
    if (Number(req.headers.get("content-length") ?? "0") > MAX_TRACE_BODY_BYTES) return tooLarge();
    let text: string;
    try {
      text = await req.text();
    } catch {
      return errorResponse(400, "bad_request", "Could not read the request body.");
    }
    if (new TextEncoder().encode(text).byteLength > MAX_TRACE_BODY_BYTES) return tooLarge();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return errorResponse(400, "bad_request", "The request body is not valid JSON.");
    }
    const parsed = BatchSchema.safeParse(json);
    if (!parsed.success) {
      return errorResponse(400, "bad_request", "Expected { version: 1, traces, events }.");
    }
    if (opts.store) {
      const batch: TraceBatch = {
        version: 1,
        traces: parsed.data.traces as unknown as DecisionTrace[],
        events: parsed.data.events as TimedEvent[],
      };
      try {
        opts.store.append(batch);
      } catch (err) {
        log(err instanceof Error ? err.message : String(err));
        return errorResponse(503, "provider_unavailable", "Traces could not be saved right now.");
      }
    }
    return new Response(null, { status: 204 });
  };
}

function tooLarge(): Response {
  return errorResponse(413, "bad_request", "The request body is too large.");
}

/** True when the server stores traces (MORPH_TRACE_DIR is set). */
export function traceStorageEnabled(env: Record<string, string | undefined>): boolean {
  return (env.MORPH_TRACE_DIR ?? "").trim() !== "";
}
