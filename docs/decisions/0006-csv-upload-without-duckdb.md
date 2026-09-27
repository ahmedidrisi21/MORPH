# 0006 — CSV upload without DuckDB-WASM

## Context
SPEC §15 describes CSV upload as "a DuckDB-WASM FactsEngine and schema-driven templates".
DuckDB-WASM is not in the §4 dependency list, so adding it needs a human. On 2026-09-27 the user
chose "no new dependencies" for the post-MVP work.

## Decision
- Uploads are parsed in the browser with `papaparse` (already in §4) by
  `apps/demo/lib/facts/upload.ts`. Limits: 20 MB and 200,000 rows.
- The schema step is a column mapping onto the sales roles: order date, revenue and customer are
  required; customer name, segment, cost and order ID are optional. `suggestMapping()` guesses
  from header names and value types, and the user can change every choice before building.
- Mapped rows go through the existing TypeScript facts engine, so the templates, specs, goldens
  and gate are unchanged. The engine's capabilities already adapt the tree to the data (for
  example, no segment column means no `has_segments`).
- I5: uploaded customer IDs are replaced by synthetic IDs (`c00001`, …) before they reach facts,
  and the original name or ID goes to `ctx.untrusted`. Segment labels appear in fact text, so
  only short labels in a safe character set are kept; anything else becomes "Other", and only
  the 12 biggest segments are kept.
- I4: rows never leave the browser. Providers see only the lens, as before.

## Consequences
- Files that are not order-shaped (no date, revenue and customer) cannot be used yet.
- Very large files are bounded by the in-memory engine. DuckDB-WASM can replace the engine later
  behind the same `FactsEngine` interface if a human approves the dependency.
