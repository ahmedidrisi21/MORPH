# Progress

Current milestone: M4 (M2 done early; M3/M5-data/M6-route in parallel threads)
Last goal:check: GOAL NOT MET — next: G3 Golden scenarios (M0 scaffold only)
Updated: 2026-09-27

## M0 — Scaffold ✅ done
- [x] A fresh clone passes `pnpm install && pnpm verify` with an empty env.
- [x] `pnpm dev` serves a placeholder demo page.
- [x] Adding `import React from "react"` to a core file fails `pnpm verify`.

Notes: pnpm workspace (`packages/core`, `packages/react`, `apps/demo`), TypeScript 7.0.2 (works with Next 16.3 — no pin needed), Biome 2.5 with restricted imports for core, `scripts/check-boundaries.mjs` (+ test), CI without secrets, `.env.example`, MIT LICENSE placeholder, ADR 0001, `scripts/goal-check.mjs`, `GOAL.md` (copied from the project brief).

## M1 — Static runtime (no AI) ✅ done
- [x] A demo button toggles between two hard-coded states with animated add/remove/move.
- [x] Invalid props never reach a component: `MorphError` renders instead and the failure is traced.

Notes: `/playground` page + `apps/demo/e2e/playground.spec.ts` (desktop + 360 px). React bindings in `packages/react` (MorphProvider asserts registry/renderer completeness; MorphRenderer Zod-validates and emits `render_error`). Demo components on shadcn-style primitives (ADR 0002). Additive APIs: ADR 0003.

## M2 — Decision layer, offline ✅ done
- [x] Specs sharing a lens state become exactly one batch.
- [x] A cache hit makes zero provider calls.
- [x] Composite falls back on both throw and timeout, and records it.

Notes: tests in `packages/core/src/decisions/*.test.ts` and `providers/providers.test.ts`. Core coverage 97% lines / 91% branches.

## M3 — Jev provider and server route
- [ ] With a key and `MORPH_PROVIDER=jev`, one user turn issues exactly one `systemOne` request. Test this with the SDK's injectable `fetch`.
- [ ] Without a key, the demo runs on replay/rules.
- [ ] The client bundle contains no SDK code or keys.

## M4 — Resolver, gate, policy
- [ ] G01–G13 pass on replay, and on rules using `rulesExpect`.
- [ ] Beam-vs-brute-force property test passes.
- [ ] `override()` makes zero provider calls.

## M5 — Talk-to-UI demo
- [ ] The 4-turn script (§1) works end to end with no keys, with animated morphs and no page reloads.
- [ ] Alternates and undo work.

## M6 — Narrative tier
- [ ] Unverified claims never reach the UI.
- [ ] Slots are never blank with `MORPH_NARRATIVE_PROVIDER=none`.

## M7 — Inspector and evaluation
- [ ] Every golden trace renders in the inspector.
- [ ] Metrics are unit-tested on synthetic event logs.

## M8 — Release prep
- [ ] A packed `@morph/core` installs into a fresh app and resolves a rules-only workspace.
- [ ] The demo is deployed on Vercel: replay by default, Jev via env.

## Parallel work (user asked for two extra agents, 2026-09-27)
- Agent A thread: demo server routes (`/api/morph/decide`, fixtures compile, rate limit) and `/api/morph/narrate`. Status in `docs/progress-agent-a.md`.
- Agent B thread: M5 data layer (`generate-sales.ts`, `data/sales.csv`, `lib/facts` tsFactsEngine). Status in `docs/progress-agent-b.md`.

## Next step
M4: demo tree/specs/rules/templates in `apps/demo/lib/morph`, golden scenarios G01–G13 and the golden runner.

## Open questions for a human
- none
