import { describe, expect, it } from "vitest";
import { clientIp, tokenBucket } from "./rate-limit";

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
