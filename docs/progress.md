# Progress

Current milestone: M1
Last goal:check: GOAL NOT MET — next: G3 Golden scenarios (M0 scaffold only)
Updated: 2026-09-27

## M0 — Scaffold ✅ done
- [x] A fresh clone passes `pnpm install && pnpm verify` with an empty env.
- [x] `pnpm dev` serves a placeholder demo page.
- [x] Adding `import React from "react"` to a core file fails `pnpm verify`.

Notes: pnpm workspace (`packages/core`, `packages/react`, `apps/demo`), TypeScript 7.0.2 (works with Next 16.3 — no pin needed), Biome 2.5 with restricted imports for core, `scripts/check-boundaries.mjs` (+ test), CI without secrets, `.env.example`, MIT LICENSE placeholder, ADR 0001, `scripts/goal-check.mjs`, `GOAL.md` (copied from the project brief).

## M1 — Static runtime (no AI) 🔄 in progress
- [ ] A demo button toggles between two hard-coded states with animated add/remove/move.
- [ ] Invalid props never reach a component: `MorphError` renders instead and the failure is traced.

## M2 — Decision layer, offline
- [ ] Specs sharing a lens state become exactly one batch.
- [ ] A cache hit makes zero provider calls.
- [ ] Composite falls back on both throw and timeout, and records it.

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

## Next step
M1: core types (§6, §11), registry, compose, diff; React MorphProvider/MorphRenderer/MorphWorkspace; demo components.

## Open questions for a human
- none
