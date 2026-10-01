import { unknownSpecReason } from "@/lib/morph/known-specs";
import { createDecideHandler } from "@/lib/server/decide";
import { serverProvider } from "@/lib/server/providers";
import { limiterFromEnv } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const handler = createDecideHandler({
  provider: () => serverProvider().provider,
  checkSpec: unknownSpecReason,
  // Burst of 20 turns, then 2 per second per IP.
  limiter: limiterFromEnv(process.env, {
    capacity: 20,
    refillPerSec: 2,
    perMinute: 120,
    prefix: "morph:rl:decide",
  }),
});

export async function POST(req: Request): Promise<Response> {
  return handler(req);
}
