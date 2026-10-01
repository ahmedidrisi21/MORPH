import { resolve } from "node:path";
import { jsonlTraceStore } from "morph-core/node";
import { limiterFromEnv } from "@/lib/server/rate-limit";
import { createTracesHandler, traceLensEnabled, traceStorageEnabled } from "@/lib/server/traces";

export const runtime = "nodejs";

// Its own key space, so trace uploads never use up the decide route's budget.
const limiter = limiterFromEnv(process.env, { capacity: 20, refillPerSec: 1, perMinute: 60 });

const handler = createTracesHandler({
  store: traceStorageEnabled(process.env)
    ? jsonlTraceStore(resolve(process.env.MORPH_TRACE_DIR as string), {
        keepLensContent: traceLensEnabled(process.env),
      })
    : null,
  limiter: { take: (ip) => limiter.take(`traces:${ip}`) },
});

export async function POST(req: Request): Promise<Response> {
  return handler(req);
}
