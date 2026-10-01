import { describe, expect, it } from "vitest";
import { DecisionSpecSchema } from "../decisions/spec";
import type { Fact } from "../facts/types";
import type { DecisionBatch, DecisionProvider } from "../providers/types";
import {
  CLAIM_SUPPORT_SPEC,
  CLAIM_SUPPORT_THRESHOLD,
  checkClaimSupport,
  claimSupportState,
} from "./support";

const facts: Fact[] = [
  { id: "a", label: "A", value: -17, unit: "pct", text: "Revenue fell 17%." },
  { id: "b", label: "B", value: "Enterprise", text: "Enterprise drove most of the decline." },
  { id: "c", label: "C", value: 7, text: "7 customers are at risk." },
];
const claim = { text: "Revenue fell 17%.", factIds: ["a"] };

function provider(p: unknown, seen: DecisionBatch[] = []): DecisionProvider {
  return {
    name: "fake",
    calibrated: true,
    async evaluate(batch) {
      seen.push(batch);
      const meta = { provider: "fake", model: "m", calibrated: true, latencyMs: 1, cached: false };
      return { [CLAIM_SUPPORT_SPEC.id]: { kind: "noul", p: p as number, meta } };
    },
  };
}

describe("claim support check (SPEC §12.4)", () => {
  it("uses a valid noul spec", () => {
    expect(DecisionSpecSchema.safeParse(CLAIM_SUPPORT_SPEC).success).toBe(true);
    expect(CLAIM_SUPPORT_SPEC.kind).toBe("noul");
  });

  it("sends only the cited facts' sentences, and the claim under `untrusted` (I4, I5)", () => {
    expect(claimSupportState(claim, facts)).toEqual({
      facts: [{ id: "a", text: "Revenue fell 17%." }],
      untrusted: { claim: "Revenue fell 17%." },
    });
  });

  it("supports a claim at or above 0.7 and rejects one below", async () => {
    expect(CLAIM_SUPPORT_THRESHOLD).toBe(0.7);
    expect(await checkClaimSupport(provider(0.7), claim, facts)).toEqual({
      supported: true,
      p: 0.7,
    });
    expect(await checkClaimSupport(provider(0.69), claim, facts)).toEqual({
      supported: false,
      p: 0.69,
    });
  });

  it("passes the abort signal and the single spec to the provider", async () => {
    const seen: DecisionBatch[] = [];
    const ctl = new AbortController();
    await checkClaimSupport(provider(0.9, seen), claim, facts, { signal: ctl.signal });
    expect(seen[0]?.signal).toBe(ctl.signal);
    expect(seen[0]?.specs).toEqual([CLAIM_SUPPORT_SPEC]);
  });

  it("throws when the answer has no probability, and when the provider fails", async () => {
    await expect(checkClaimSupport(provider(Number.NaN), claim, facts)).rejects.toThrow(
      /no support/,
    );
    const failing: DecisionProvider = {
      name: "f",
      calibrated: true,
      evaluate: () => Promise.reject(new Error("boom")),
    };
    await expect(checkClaimSupport(failing, claim, facts)).rejects.toThrow("boom");
  });
});
