// Per-IP token bucket, in memory (SPEC §13.5). One bucket map per server process; an Upstash
// adapter replaces this in M8.

export interface RateLimiter {
  /** Take one token for `key`. Returns false when the bucket is empty. */
  take(key: string): boolean;
}

export interface TokenBucketOptions {
  /** Burst size. */
  capacity: number;
  /** Tokens added per second. */
  refillPerSec: number;
  clock?: () => number;
  /** Buckets kept before the oldest are evicted. */
  maxKeys?: number;
}

export function tokenBucket(opts: TokenBucketOptions): RateLimiter {
  const clock = opts.clock ?? Date.now;
  const maxKeys = opts.maxKeys ?? 10_000;
  const buckets = new Map<string, { tokens: number; at: number }>();
  return {
    take(key) {
      const now = clock();
      const b = buckets.get(key) ?? { tokens: opts.capacity, at: now };
      const refilled = Math.min(
        opts.capacity,
        b.tokens + ((now - b.at) / 1000) * opts.refillPerSec,
      );
      const ok = refilled >= 1;
      buckets.delete(key);
      buckets.set(key, { tokens: ok ? refilled - 1 : refilled, at: now });
      if (buckets.size > maxKeys) {
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
      }
      return ok;
    },
  };
}

/** Client IP from proxy headers (first hop), or "unknown". */
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
