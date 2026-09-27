import { ACTION_IDS } from "@/lib/morph/registry";
import { createNarrateHandler } from "@/lib/server/narrate";
import { serverClaimStreamer } from "@/lib/server/narrative-model";
import { tokenBucket } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const handler = createNarrateHandler({
  streamer: serverClaimStreamer,
  actionIds: ACTION_IDS,
  // A turn fills a few slots: burst of 40, then 4 per second per IP.
  limiter: tokenBucket({ capacity: 40, refillPerSec: 4 }),
});

export async function POST(req: Request): Promise<Response> {
  return handler(req);
}
