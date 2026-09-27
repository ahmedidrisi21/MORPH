# Progress — parallel agent B

Branch: `claude/project-thread-dr2f3t` (based on `claude/project-thread-tqrdne` @ 1c0f1d8)
Scope: M5 data layer. The main thread merges this into `docs/progress.md`.
Updated: 2026-09-27

## Done
- [x] `apps/demo/scripts/generate-sales.ts`: seeded (mulberry32, seed 20260925) generator, pure `generateSalesCsv()`. Run with `pnpm --filter @morph/demo generate:data` (Node ≥ 22.18 strips the types; no new dependency).
- [x] `apps/demo/data/sales.csv` committed: 24 months (2024-09 … 2026-08), 200 customers, 5 segments, 21,547 orders.
- [x] `apps/demo/lib/facts/`: `parseSalesCsv` (papaparse + Zod), `computeSalesFacts` / `tsFactsEngine`, `salesUntrusted`.
- [x] Test for M5 "the facts engine reproduces the planted story": revenue −17.1% (large decline), Enterprise top contributor (93% of the change), 7 recoverable customers (all Enterprise), 5 lapsed. The test also checks that the committed CSV equals the generator output, and that no customer name reaches any fact (I5).

## Fact catalog (for templates)
Periods: `last_3m` = the last 3 months in the data; `prior_3m` = the 3 before. `asOf` defaults to the first day after the last month.
- `<metric>.total.last_3m`, `<metric>.total.prior_3m`, `<metric>.change_pct.last_3m` (bucket) for metric ∈ `revenue | orders | profit | customer_count`
- `<metric>.month.<YYYY-MM>`: 24-month series per metric
- `segment.<slug>.revenue.last_3m`, `.revenue_change_usd.last_3m`, `.revenue_change_pct.last_3m` (bucket), `.contribution_pct` (share bucket); slugs `enterprise | mid_market | smb | education | public_sector`
- `segment.top_contributor` (value = segment name)
- `customer.<id>.revenue_change_usd.last_3m`: top 10 contributors, IDs only
- `customers.recoverable.count`, `customers.recoverable.revenue_gap_usd`, `customers.lapsed.count`, `customers.declining.count`
- `revenue.anomaly.<YYYY-MM>` (z-score, only flagged months), `revenue.anomaly.count`
- Filters (customer IDs, ranked): `recoverable`, `high_impact` (top 10 by |Δ revenue|), `declining` (≤ −5%), `top_n` (top 10 by last-3m revenue)
- Capabilities: `has_time_series`, `has_two_periods`, `has_segments`, `has_customers`
- Customer names only go to `ctx.untrusted.customer_names` via `salesUntrusted(rows)`.

## Verify
`pnpm typecheck`, `pnpm test` (193 passed), `pnpm test:golden`, `pnpm check:boundaries` are green on this branch. `pnpm lint` is red only because of two `useAriaPropsSupportedByRole` errors in `packages/react/src/MorphAlternates.tsx:9` and `MorphIntentBar.tsx:46`, which come from the base commit 1c0f1d8 (main thread's in-progress M1 work), not from this branch. `biome check apps/demo/lib apps/demo/scripts` is clean.

## Next
- Main thread: merge this branch, then wire `tsFactsEngine` into the demo (load `sales.csv` client-side) and build the remaining leaf templates against the fact catalog above.

## Open questions for a human
- none
