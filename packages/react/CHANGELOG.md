# morph-react

## 0.2.0

### Minor Changes

- f394162: morph-core: `policy.canAct` is now enforced when workspaces are composed. `CapabilityDef` gets an
  optional `actions` hook (`ids`, `keep`), and `compose()` and pruning drop the actions a user may not
  take (`checkActions`). Trace ingestion is hardened: new `DecisionTraceSchema`, `TimedEventSchema` and
  `TraceBatchSchema` (strict and bounded), `jsonlTraceStore({ maxBytesPerDay })` with
  `TraceStoreFullError`, and `readTraceStore` now skips traces and events that fail the schema. Fixes:
  answers that came after a provider fallback are no longer cached, and `verifyClaims` drops a claim
  that says the opposite of the facts it cites.
  
  morph-react: version bump only (the packages are released together).

### Patch Changes

- c006073: Add `Morph.recordNarrative` and `NarrativeRecord` so narrative outcomes (claims in, kept, drop reasons) are recorded in traces. `summarize` reports narrative metrics, and the inspector shows them.
- Updated dependencies [2ccfe7f]
- Updated dependencies [b465e8e]
- Updated dependencies [f394162]
- Updated dependencies [c006073]
- Updated dependencies [75423d0]
  - morph-core@0.2.0

## 0.1.0

### Minor Changes

- b6637fc: First release: the MORPH runtime (facts, decision specs, providers, beam search, stability gate,
  policy, compose, diff, narrative verifier, traces) and the React bindings with the inspector.

### Patch Changes

- Updated dependencies [b6637fc]
  - morph-core@0.1.0
