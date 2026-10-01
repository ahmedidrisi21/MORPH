import {
  type Claim,
  type ClaimSupport,
  checkClaimSupport,
  type DecisionProvider,
  type Fact,
} from "morph-core";
import { DEFAULT_JEV_MODEL, JevProvider } from "morph-core/providers/jev";
import type { ClaimChecker } from "./narrate";

// The optional semantic claim check (SPEC §12.4), server only. MORPH_NARRATIVE_CHECK=jev asks Jev
// whether each claim that passed `verifyClaims` is fully supported by the facts it cites. It
// sends those facts' sentences and the claim, never rows. Off by default (zero-key operation, I9).

export const CLAIM_CHECK_BUDGET_MS = 4000;

export interface ClaimCheckEnv {
  [name: string]: string | undefined;
  MORPH_NARRATIVE_CHECK?: string | undefined;
  TYPESAFE_API_KEY?: string | undefined;
  MORPH_JEV_MODEL?: string | undefined;
}

export interface ClaimCheckSelection {
  checker: ClaimChecker | null;
  /** Why the check is off although it was asked for. */
  note?: string;
}

export function selectClaimChecker(
  env: ClaimCheckEnv,
  deps: { provider?: (opts: { apiKey: string; model: string }) => DecisionProvider } = {},
): ClaimCheckSelection {
  const requested = (env.MORPH_NARRATIVE_CHECK || "none").trim().toLowerCase();
  if (requested === "none") return { checker: null };
  if (requested !== "jev") {
    return { checker: null, note: `Unknown MORPH_NARRATIVE_CHECK "${requested}": check is off.` };
  }
  if (!env.TYPESAFE_API_KEY) {
    return {
      checker: null,
      note: "MORPH_NARRATIVE_CHECK=jev without TYPESAFE_API_KEY: check is off.",
    };
  }
  const make = deps.provider ?? ((o) => new JevProvider(o));
  const provider = make({
    apiKey: env.TYPESAFE_API_KEY,
    model: env.MORPH_JEV_MODEL || DEFAULT_JEV_MODEL,
  });
  const checker = (claim: Claim, facts: Fact[], signal: AbortSignal): Promise<ClaimSupport> =>
    checkClaimSupport(provider, claim, facts, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(CLAIM_CHECK_BUDGET_MS)]),
    });
  return { checker };
}

let cached: ClaimCheckSelection | undefined;

/** One checker per server process, built from process.env on first use. */
export function serverClaimChecker(): ClaimChecker | null {
  if (!cached) {
    cached = selectClaimChecker(process.env);
    if (cached.note) console.warn(`[morph] ${cached.note}`);
  }
  return cached.checker;
}
