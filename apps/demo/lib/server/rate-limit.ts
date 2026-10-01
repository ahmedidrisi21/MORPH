// Per-IP rate limits (SPEC §13.5). In memory by default (one bucket map per server process);
// `upstashFixedWindow` shares the limit across serverless instances when Upstash env vars are set.

export interface RateLimiter {
  /** Take one token for `key`. Returns false when the bucket is empty. */
  take(key: string): boolean | Promise<boolean>;
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

/** Minimal fetch shape, so tests can inject one. */
export type RateLimitFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export interface UpstashOptions {
  /** UPSTASH_REDIS_REST_URL */
  url: string;
  /** UPSTASH_REDIS_REST_TOKEN (server only) */
  token: string;
  /** Requests allowed per window. */
  limit: number;
  windowSec: number;
  prefix?: string;
  clock?: () => number;
  fetchImpl?: RateLimitFetch;
  /** Used when Upstash cannot be reached, so an outage never blocks the demo. */
  fallback: RateLimiter;
}

/**
 * Fixed-window limiter over the Upstash Redis REST API (INCR + EXPIRE in one pipeline call).
 * No SDK dependency: it is a single fetch.
 */
export function upstashFixedWindow(opts: UpstashOptions): RateLimiter {
  const clock = opts.clock ?? Date.now;
  const f: RateLimitFetch =
    opts.fetchImpl ?? ((url, init) => (globalThis.fetch as unknown as RateLimitFetch)(url, init));
  const prefix = opts.prefix ?? "morph:rl";
  return {
    async take(key) {
      const window = Math.floor(clock() / 1000 / opts.windowSec);
      const k = `${prefix}:${key}:${window}`;
      try {
        const res = await f(`${opts.url.replace(/\/$/, "")}/pipeline`, {
          method: "POST",
          headers: { authorization: `Bearer ${opts.token}`, "content-type": "application/json" },
          body: JSON.stringify([
            ["INCR", k],
            ["EXPIRE", k, String(opts.windowSec)],
          ]),
        });
        if (!res.ok) return opts.fallback.take(key);
        const body = (await res.json()) as { result?: unknown }[];
        const count = Number(body[0]?.result);
        if (!Number.isFinite(count)) return opts.fallback.take(key);
        return count <= opts.limit;
      } catch {
        return opts.fallback.take(key);
      }
    },
  };
}

/**
 * Upstash when both env vars are set, otherwise the in-memory bucket.
 *
 * `prefix` is required: every route needs its own Redis key space. Routes that share a prefix
 * share one counter, so one route's traffic would use up another's budget, each against its own
 * limit. (In memory each limiter already has its own buckets, so the bug only shows with Upstash.)
 */
export function limiterFromEnv(
  env: Record<string, string | undefined>,
  bucket: TokenBucketOptions & { perMinute: number; prefix: string },
): RateLimiter {
  const memory = tokenBucket(bucket);
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return memory;
  return upstashFixedWindow({
    url,
    token,
    limit: bucket.perMinute,
    windowSec: 60,
    prefix: bucket.prefix,
    ...(bucket.clock ? { clock: bucket.clock } : {}),
    fallback: memory,
  });
}
