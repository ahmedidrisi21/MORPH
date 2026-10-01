import type { DecisionBatch, DecisionProvider } from "morph-core";
import { describe, expect, it } from "vitest";
import { selectClaimChecker } from "./claim-check";

const facts = [{ id: "a", label: "A", value: -17, text: "Revenue fell 17%." }];
const claim = { text: "Revenue fell 17%.", factIds: ["a"] };

function fake(p: number, seen: DecisionBatch[] = []): DecisionProvider {
  return {
    name: "fake",
    calibrated: true,
    async evaluate(batch) {
      seen.push(batch);
      const meta = { provider: "fake", model: "m", calibrated: true, latencyMs: 1, cached: false };
      return { "narrative.claim_supported": { kind: "noul", p, meta } };
    },
  };
}

describe("selectClaimChecker", () => {
  it("is off by default and with MORPH_NARRATIVE_CHECK=none", () => {
    expect(selectClaimChecker({}).checker).toBeNull();
    expect(
      selectClaimChecker({ MORPH_NARRATIVE_CHECK: "none", TYPESAFE_API_KEY: "k" }).checker,
    ).toBeNull();
  });

  it("says why it stays off for a missing key or an unknown value", () => {
    const noKey = selectClaimChecker({ MORPH_NARRATIVE_CHECK: "jev" });
    expect(noKey.checker).toBeNull();
    expect(noKey.note).toMatch(/without TYPESAFE_API_KEY/);
    const unknown = selectClaimChecker({ MORPH_NARRATIVE_CHECK: "gpt", TYPESAFE_API_KEY: "k" });
    expect(unknown.checker).toBeNull();
    expect(unknown.note).toMatch(/Unknown MORPH_NARRATIVE_CHECK/);
  });

  it("builds the provider with the pinned model and checks a claim", async () => {
    const seen: DecisionBatch[] = [];
    let opts: { apiKey: string; model: string } | undefined;
    const { checker } = selectClaimChecker(
      { MORPH_NARRATIVE_CHECK: " JEV ", TYPESAFE_API_KEY: "k", MORPH_JEV_MODEL: "jev-1.13.0" },
      {
        provider: (o) => {
          opts = o;
          return fake(0.82, seen);
        },
      },
    );
    expect(opts).toEqual({ apiKey: "k", model: "jev-1.13.0" });
    const r = await checker?.(claim, facts, new AbortController().signal);
    expect(r).toEqual({ supported: true, p: 0.82 });
    expect(seen[0]?.signal).toBeDefined();
  });
});
