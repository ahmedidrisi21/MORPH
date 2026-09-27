import { unknownSpecReason } from "@/lib/morph/known-specs";
import { createDecideHandler } from "@/lib/server/decide";
import { serverProvider } from "@/lib/server/providers";
import { tokenBucket } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const handler = createDecideHandler({
  provider: () => serverProvider().provider,
  checkSpec: unknownSpecReason,
  // Burst of 20 turns, then 2 per second per IP.
  limiter: tokenBucket({ capacity: 20, refillPerSec: 2 }),
});

export async function POST(req: Request): Promise<Response> {
  return handler(req);
}
