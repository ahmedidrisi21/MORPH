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
- Not yet measured against live Jev: whether p separates the corpus claims. Before turning it on by default, run the corpus through `checkClaimSupport` with a real key and compare with each claim's `should`.
- Fail-closed means a Jev outage turns the AI tag off, not the slot blank.
