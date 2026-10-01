# 0018 — Jev support check for narrative claims

## Context
`verifyClaims` is deterministic (ADR 0017) and cannot judge meaning. SPEC §12.4 lists an optional Jev `noul` check per surviving claim. The one gap left in the claim corpus is a cause that reuses a causal word from another cited fact.

## Decision
- Core adds `CLAIM_SUPPORT_SPEC`, `claimSupportState`, `checkClaimSupport` and `CLAIM_SUPPORT_THRESHOLD` (0.7). It works with any `DecisionProvider`; core imports no Jev code.
- The state sent is the cited facts' sentences (code-written) and the claim under `untrusted` (I5). No rows, no other facts (I3, I4).
- The demo's narrate route takes an optional `checker`. `MORPH_NARRATIVE_CHECK=jev` plus `TYPESAFE_API_KEY` turns it on; the default is off, so `pnpm verify` and CI stay key-free (I9). One Jev call per claim that passed `verifyClaims` (at most 4), 4 s budget each.
- Fail closed: if the check errors or times out, the claim is dropped with `support check failed (<status>)`. When no claim survives, the slot shows the facts' own sentences. The client sees the status code at most.
- Metrics count `support check failed` as a narrative error; a claim Jev rejected (`not supported by the facts (p=0.31)`) is a normal drop.

## Consequences
- Extra latency and Jev requests on the shared rate limit: up to 4 calls per slot, on top of the narrative LLM.
- Facts' sentences and AI claims go to Jev when it is on. The README says so.
- Measured against live `jev-1.13.0` on 2026-10-01 (30 corpus claims, run twice, same result both times): 27 agree with `should`. With only fact sentences in the state it was 26 of 31 (the "17.1%" claim was dropped), so the state now also carries each fact's `value` and `unit`.
  - Caught: "Revenue fell because of a price increase" (p=0.03), the claim the deterministic checks miss.
  - Kept correct claims at p 0.70–0.98. "small count as a word" sits at exactly 0.70, so a model update could tip it.
  - Dropped, though the corpus says keep: both year claims (p about 0.05; 2026 is in no fact, so this is defensible and falls back safely).
  - Kept, though the corpus says drop: "$2.2M" for $2.27M (p about 0.75). The deterministic check already drops it before Jev is asked.
  - Jev is a second layer, not a replacement: each layer catches something the other misses.
- Fail-closed means a Jev outage turns the AI tag off, not the slot blank.
