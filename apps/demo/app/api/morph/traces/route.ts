import { resolve } from "node:path";
import { jsonlTraceStore } from "morph-core/node";
import { limiterFromEnv } from "@/lib/server/rate-limit";
import {
  createTracesHandler,
  traceLensEnabled,
  traceMaxDayBytes,
  traceStorageEnabled,
} from "@/lib/server/traces";

export const runtime = "nodejs";

// Its own key space, so trace uploads never use up the decide route's budget.
const limiter = limiterFromEnv(process.env, {
  capacity: 20,
  refillPerSec: 1,
  perMinute: 60,
  prefix: "morph:rl:traces",
});

const handler = createTracesHandler({
  store: traceStorageEnabled(process.env)
    ? jsonlTraceStore(resolve(process.env.MORPH_TRACE_DIR as string), {
        keepLensContent: traceLensEnabled(process.env),
        maxBytesPerDay: traceMaxDayBytes(process.env),
      })
    : null,
  limiter,
});

export async function POST(req: Request): Promise<Response> {
  return handler(req);
}
