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

const DOWN =
  /\b(fell|fall(?:s|ing|en)?|declin\w*|drop(?:s|ped|ping)?|decreas\w*|shr[ia]nk\w*|lower|down)\b/i;
const UP =
  /\b(rose|ris(?:e|es|ing|en)|grew|grow(?:s|th|ing)?|increas\w*|climb\w*|gain\w*|higher|up)\b/i;

/** "up" or "down" when the text points one way only; null when neutral or mixed. */
function direction(text: string): "up" | "down" | null {
  const down = DOWN.test(text);
  const up = UP.test(text);
  return down === up ? null : down ? "down" : "up";
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
 * fact, when any number in its text does not match a referenced fact (|value| rounded to 0
 * or 1 decimal places, or present verbatim in the fact's text), or when it says the opposite of
 * every referenced fact that has a direction ("grew 17%" against a fact that says revenue fell).
 *
 * The direction check reads the verbs in the claim and in the facts' code-generated text. It only
 * drops a claim that points one way while all directional facts it cites point the other, so a
 * claim that mixes directions, or cites no directional fact, is left to the number check.
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
    const said = direction(claim.text);
    const factDirs = refs.map((f) => direction(f.text)).filter((d) => d !== null);
    if (said && factDirs.length > 0 && factDirs.every((d) => d !== said)) {
      dropped.push({ claim, reason: `says "${said}", the cited fact(s) say "${factDirs[0]}"` });
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
