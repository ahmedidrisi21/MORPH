---
"morph-core": minor
"morph-react": minor
---

morph-core: `policy.canAct` is now enforced when workspaces are composed. `CapabilityDef` gets an
optional `actions` hook (`ids`, `keep`), and `compose()` and pruning drop the actions a user may not
take (`checkActions`). Trace ingestion is hardened: new `DecisionTraceSchema`, `TimedEventSchema` and
`TraceBatchSchema` (strict and bounded), `jsonlTraceStore({ maxBytesPerDay })` with
`TraceStoreFullError`, and `readTraceStore` now skips traces and events that fail the schema. Fixes:
answers that came after a provider fallback are no longer cached, and `verifyClaims` drops a claim
that says the opposite of the facts it cites.

morph-react: version bump only (the packages are released together).
