import { describe, expect, it } from "vitest";
import type { Answer } from "../decisions/answer";
import { canonicalJSON } from "./canonical";
import { fnv1a64 } from "./fnv";
import { LruCache } from "./lru";

const answer = (p: number): Answer => ({
  kind: "noul",
  p,
  meta: { provider: "t", model: null, calibrated: false, latencyMs: 0, cached: false },
});

describe("canonicalJSON", () => {
  it("sorts keys recursively and drops undefined", () => {
    expect(canonicalJSON({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });
  it("is order-independent", () => {
    expect(canonicalJSON({ x: 1, y: 2 })).toBe(canonicalJSON({ y: 2, x: 1 }));
  });
});

describe("fnv1a64", () => {
  it("matches known FNV-1a 64 vectors", () => {
    expect(fnv1a64("")).toBe("cbf29ce484222325");
    expect(fnv1a64("a")).toBe("af63dc4c8601ec8c");
    expect(fnv1a64("foobar")).toBe("85944171f73967e8");
  });
  it("hashes UTF-8 bytes", () => {
    expect(fnv1a64("é")).not.toBe(fnv1a64("e"));
    expect(fnv1a64("x")).toHaveLength(16);
  });
});

describe("LruCache", () => {
  it("returns values until they expire", async () => {
    let now = 0;
    const c = new LruCache({ clock: () => now });
    await c.set("k", answer(0.3), 100);
    expect((await c.get("k"))?.kind).toBe("noul");
    now = 100;
    expect(await c.get("k")).toBeUndefined();
    expect(c.size).toBe(0);
  });
  it("evicts the least recently used entry", async () => {
    const c = new LruCache({ max: 2 });
    await c.set("a", answer(0.1));
    await c.set("b", answer(0.2));
    await c.get("a");
    await c.set("c", answer(0.3));
    expect(await c.get("b")).toBeUndefined();
    expect(await c.get("a")).toBeDefined();
    expect(await c.get("c")).toBeDefined();
  });
  it("misses on unknown keys", async () => {
    expect(await new LruCache().get("nope")).toBeUndefined();
  });
});
