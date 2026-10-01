import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Fact } from "../facts/types";
import { verifyClaims } from "./verify";

// A corpus of model-style claims against real demo facts (fixtures/narrative/claims.json). Each
// claim has `should` (what a correct verifier does) and `today` (what verifyClaims does now).
// `today` is pinned: a verifier change fails here until the corpus is updated on purpose, and the
// gaps (should != today) are listed, not forgotten.

interface Entry {
  name: string;
  text: string;
  factIds: string[];
  should: "keep" | "drop";
  today: "keep" | "drop";
  note?: string;
}
const corpus = JSON.parse(
  readFileSync(new URL("../../../../fixtures/narrative/claims.json", import.meta.url), "utf8"),
) as { facts: Fact[]; claims: Entry[] };

const verdict = (e: Entry) =>
  verifyClaims([{ text: e.text, factIds: e.factIds }], corpus.facts).kept.length ? "keep" : "drop";

describe("narrative claim corpus", () => {
  it("has the claims and facts it is meant to", () => {
    expect(corpus.claims.length).toBeGreaterThanOrEqual(20);
    expect(new Set(corpus.claims.map((c) => c.name)).size).toBe(corpus.claims.length);
    for (const e of corpus.claims) {
      expect(["keep", "drop"]).toContain(e.should);
      expect(["keep", "drop"]).toContain(e.today);
    }
  });

  for (const e of corpus.claims) {
    it(`${e.name}: verifyClaims ${e.today}s it${e.should === e.today ? "" : ` (gap: it should ${e.should})`}`, () => {
      expect(verdict(e)).toBe(e.today);
    });
  }

  it("lists the gaps, so they are tracked rather than forgotten", () => {
    const gaps = corpus.claims.filter((e) => e.should !== e.today);
    // Wrong claims let through, and correct claims wrongly dropped.
    const falseKeeps = gaps.filter((e) => e.should === "drop").map((e) => e.name);
    const falseDrops = gaps.filter((e) => e.should === "keep").map((e) => e.name);
    expect(falseKeeps).toEqual([
      "a fraction in words",
      "a percentage in words",
      "halved",
      "wrong unit",
      "wrong entity",
      "right number, wrong subject",
      "a cause the facts do not give",
      "negated",
      "a scope the facts do not have",
    ]);
    expect(falseDrops).toEqual(["compact money", "money in thousands", "a year"]);
    // Every gap says why.
    for (const e of gaps) expect(e.note, e.name).toBeTruthy();
  });
});
