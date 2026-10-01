import { ACTION_IDS } from "@/lib/morph/registry";
import { serverClaimChecker } from "@/lib/server/claim-check";
import { createNarrateHandler } from "@/lib/server/narrate";
import { serverClaimStreamer } from "@/lib/server/narrative-model";
import { limiterFromEnv } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const handler = createNarrateHandler({
  streamer: serverClaimStreamer,
  checker: serverClaimChecker,
  actionIds: ACTION_IDS,
  // A turn fills a few slots: burst of 40, then 4 per second per IP.
  limiter: limiterFromEnv(process.env, {
    capacity: 40,
    refillPerSec: 4,
    perMinute: 240,
    prefix: "morph:rl:narrate",
  }),
});

export async function POST(req: Request): Promise<Response> {
  return handler(req);
}
