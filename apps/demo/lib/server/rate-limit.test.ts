import { describe, expect, it } from "vitest";
import {
  clientIp,
  limiterFromEnv,
  type RateLimitFetch,
  tokenBucket,
  upstashFixedWindow,
} from "./rate-limit";

describe("tokenBucket", () => {
  it("allows a burst, then refills over time", () => {
    let now = 0;
    const limiter = tokenBucket({ capacity: 2, refillPerSec: 1, clock: () => now });
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false);
    expect(limiter.take("b")).toBe(true);
    now = 1000;
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false);
  });

  it("evicts the oldest bucket beyond maxKeys", () => {
    const limiter = tokenBucket({ capacity: 1, refillPerSec: 0, clock: () => 0, maxKeys: 1 });
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("b")).toBe(true);
    expect(limiter.take("a")).toBe(true);
  });
});

describe("clientIp", () => {
  it("reads the first forwarded hop, then x-real-ip", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIp(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("upstashFixedWindow", () => {
  const never = { take: () => false };
  const redis = () => {
    const counts = new Map<string, number>();
    const calls: { url: string; auth: string; body: unknown }[] = [];
    const fetchImpl: RateLimitFetch = async (url, init) => {
      const body = JSON.parse(init.body) as string[][];
      calls.push({ url, auth: init.headers.authorization ?? "", body });
      const key = body[0]?.[1] ?? "";
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { ok: true, json: async () => [{ result: n }, { result: 1 }] };
    };
    return { fetchImpl, calls };
  };

  it("allows `limit` requests per window and key, then blocks", async () => {
    let now = 0;
    const r = redis();
    const l = upstashFixedWindow({
      url: "https://example.upstash.io/",
      token: "t",
      limit: 2,
      windowSec: 60,
      clock: () => now,
      fetchImpl: r.fetchImpl,
      fallback: never,
    });
    expect([await l.take("a"), await l.take("a"), await l.take("a")]).toEqual([true, true, false]);
    expect(await l.take("b")).toBe(true);
    now = 61_000;
    expect(await l.take("a")).toBe(true);
    expect(r.calls[0]?.url).toBe("https://example.upstash.io/pipeline");
    expect(r.calls[0]?.auth).toBe("Bearer t");
    expect(r.calls[0]?.body).toEqual([
      ["INCR", "morph:rl:a:0"],
      ["EXPIRE", "morph:rl:a:0", "60"],
    ]);
  });

  it("uses the fallback when Upstash fails or answers oddly", async () => {
    const opts = { url: "u", token: "t", limit: 1, windowSec: 60, fallback: { take: () => true } };
    const down = upstashFixedWindow({
      ...opts,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    const bad = upstashFixedWindow({
      ...opts,
      fetchImpl: async () => ({ ok: false, json: async () => [] }),
    });
    const odd = upstashFixedWindow({
      ...opts,
      fetchImpl: async () => ({ ok: true, json: async () => [{}] }),
    });
    expect([await down.take("a"), await bad.take("a"), await odd.take("a")]).toEqual([
      true,
      true,
      true,
    ]);
  });
});

describe("limiterFromEnv", () => {
  const bucket = { capacity: 1, refillPerSec: 0, perMinute: 60, clock: () => 0 };
  it("uses the in-memory bucket without Upstash env", async () => {
    const l = limiterFromEnv({}, bucket);
    expect([await l.take("a"), await l.take("a")]).toEqual([true, false]);
  });
  it("uses Upstash when both env vars are set", async () => {
    const original = globalThis.fetch;
    let called = "";
    globalThis.fetch = (async (url: string) => {
      called = url;
      return { ok: true, json: async () => [{ result: 1 }] };
    }) as unknown as typeof fetch;
    try {
      const l = limiterFromEnv(
        { UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" },
        bucket,
      );
      expect(await l.take("a")).toBe(true);
      expect(called).toBe("https://x.upstash.io/pipeline");
    } finally {
      globalThis.fetch = original;
    }
  });
});
