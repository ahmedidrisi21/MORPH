import { type TraceBatch, TraceBatchSchema } from "morph-core";
import type { TraceStore } from "morph-core/node";
import { errorResponse } from "./decide";
import { clientIp, type RateLimiter } from "./rate-limit";

// POST /api/morph/traces: stores trace batches from the browser's batching sink
// (docs/backlog.md#trace-storage, ADR 0007, ADR 0015). Without MORPH_TRACE_DIR the route accepts
// and drops them, so the demo behaves the same with or without storage.
//
// The route is unauthenticated and the data is self-reported by the client. It is hardened, not
// trusted: the body must be JSON (so a cross-site form post cannot reach it without a CORS
// preflight), the schema is strict and bounded (only expected fields are stored), the store caps
// each day's file, and the readers validate again. Leave storage off on a public deployment.

export const MAX_TRACE_BODY_BYTES = 512 * 1024;
export { MAX_EVENTS_PER_BATCH, MAX_TRACES_PER_BATCH } from "morph-core";

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
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return errorResponse(415, "bad_request", "Send the batch as application/json.");
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
    const parsed = TraceBatchSchema.safeParse(json);
    if (!parsed.success) {
      return errorResponse(400, "bad_request", "Expected { version: 1, traces, events }.");
    }
    if (opts.store) {
      // Only the parsed data is stored: the schema is strict, so nothing extra rides along.
      const batch: TraceBatch = parsed.data;
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

/** True when stored traces keep lens content for the research loop (MORPH_TRACE_LENS=1). */
export function traceLensEnabled(env: Record<string, string | undefined>): boolean {
  return traceStorageEnabled(env) && env.MORPH_TRACE_LENS === "1";
}

/** Largest size of one day's trace file in bytes (MORPH_TRACE_MAX_DAY_MB, default 50). */
export const DEFAULT_TRACE_MAX_DAY_MB = 50;
export function traceMaxDayBytes(env: Record<string, string | undefined>): number {
  const mb = Number(env.MORPH_TRACE_MAX_DAY_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_TRACE_MAX_DAY_MB) * 1024 * 1024;
}
