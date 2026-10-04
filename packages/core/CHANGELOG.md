# morph-core

## 0.2.0

### Minor Changes

- 2ccfe7f: Add `checkClaimSupport`, `CLAIM_SUPPORT_SPEC`, `claimSupportState` and `CLAIM_SUPPORT_THRESHOLD`: ask any decision provider whether a narrative claim is fully supported by the facts it cites (SPEC §12.4).
- f394162: morph-core: `policy.canAct` is now enforced when workspaces are composed. `CapabilityDef` gets an
  optional `actions` hook (`ids`, `keep`), and `compose()` and pruning drop the actions a user may not
  take (`checkActions`). Trace ingestion is hardened: new `DecisionTraceSchema`, `TimedEventSchema` and
  `TraceBatchSchema` (strict and bounded), `jsonlTraceStore({ maxBytesPerDay })` with
  `TraceStoreFullError`, and `readTraceStore` now skips traces and events that fail the schema. Fixes:
  answers that came after a provider fallback are no longer cached, and `verifyClaims` drops a claim
  that says the opposite of the facts it cites.
  
  morph-react: version bump only (the packages are released together).
- c006073: Add `Morph.recordNarrative` and `NarrativeRecord` so narrative outcomes (claims in, kept, drop reasons) are recorded in traces. `summarize` reports narrative metrics, and the inspector shows them.
- 75423d0: `verifyClaims` is stricter and more exact: it reads number words and "$2.3M"-style figures, checks units, ignores years, and drops claims with names, scopes or causes the cited facts do not have, or a negated direction.

### Patch Changes

- b465e8e: `claimSupportState` also sends each cited fact's `value` and `unit`, so a claim that restates a fact at more precision than its sentence is no longer judged unsupported.

## 0.1.0

### Minor Changes

- b6637fc: First release: the MORPH runtime (facts, decision specs, providers, beam search, stability gate,
  policy, compose, diff, narrative verifier, traces) and the React bindings with the inspector.
