import type { Fact } from "../facts/types";
import type { Claim } from "./claims";

export const NUMBER_RE = /-?\d+(?:[.,]\d+)?%?/g;

export interface VerifiedClaims {
  kept: Claim[];
  dropped: { claim: Claim; reason: string }[];
}

function toNumber(token: string): number {
  return Number(token.replace(/%$/, "").replace(",", "."));
}

function matchesFact(token: string, fact: Fact): boolean {
  const inText = (fact.text.match(NUMBER_RE) ?? []).map((t) => t.replace(/%$/, ""));
  if (inText.includes(token.replace(/%$/, ""))) return true;
  if (typeof fact.value !== "number") return false;
  const n = Math.abs(toNumber(token));
  const v = Math.abs(fact.value);
  return n === Math.round(v) || n === Math.round(v * 10) / 10;
}

/**
 * Deterministic claim verification (SPEC §12.3). A claim is dropped when it cites an unknown
 * fact, or when any number in its text does not match a referenced fact (|value| rounded to 0
 * or 1 decimal places, or present verbatim in the fact's text).
 */
export function verifyClaims(claims: Claim[], facts: Fact[]): VerifiedClaims {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const kept: Claim[] = [];
  const dropped: VerifiedClaims["dropped"] = [];
  for (const claim of claims) {
    const unknown = claim.factIds.filter((id) => !byId.has(id));
    if (claim.factIds.length === 0 || unknown.length) {
      dropped.push({
        claim,
        reason: `unknown fact id(s): ${unknown.join(", ") || "(none cited)"}`,
      });
      continue;
    }
    const refs = claim.factIds.map((id) => byId.get(id) as Fact);
    const bad = (claim.text.match(NUMBER_RE) ?? []).filter(
      (tok) => !refs.some((f) => matchesFact(tok, f)),
    );
    if (bad.length) {
      dropped.push({ claim, reason: `unsupported number(s): ${bad.join(", ")}` });
      continue;
    }
    kept.push(claim);
  }
  return { kept, dropped };
}

/** Code-generated fallback: the referenced facts' own sentences. A slot is never blank. */
export function fallbackClaims(facts: Fact[]): Claim[] {
  return facts.map((f) => ({ text: f.text, factIds: [f.id] }));
}
