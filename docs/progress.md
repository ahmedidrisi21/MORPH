# Progress

Current milestone: M8 (M0–M7 done; human-only items marked HUMAN)
Last goal:check: GOAL MET (AGENT SCOPE), from a clean clone — full output in docs/handoff.md
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

## M3 — Jev provider and server route ✅ done
- [x] With a key and `MORPH_PROVIDER=jev`, one user turn issues exactly one `systemOne` request. Test this with the SDK's injectable `fetch`.
- [x] Without a key, the demo runs on replay/rules.
- [x] The client bundle contains no SDK code or keys.

Notes: built by agent A (`lib/server/decide.test.ts` covers the one-request turn with the SDK's injectable fetch, and zero-key replay → rules). Bundle: `node scripts/goal-check.mjs --only G5,G6` passes (13 static files, no SDK code or keys). Fixed the root `build` script, whose unquoted `./packages/*` glob made pnpm treat package paths as script names.

## M4 — Resolver, gate, policy ✅ done
- [ ] HUMAN: G01–G13 pass on replay, and on rules using `rulesExpect`. Recorded with jev-1.13.0 on 2026-10-01: 25 of 26 live runs pass. G11 ("look into customers and revenue") is not recorded: live Jev clarifies (path confidence 0.54) where the golden expects two alternates, and G12 shares its first turn. Open for a human: decide whether to reword the tree questions or accept the live difference. Goldens and thresholds are unchanged (ADR 0010, 0011).
- [x] Beam-vs-brute-force property test passes.
- [x] `override()` makes zero provider calls.

Notes: all 13 goldens pass on rules (`pnpm test:golden`, runner in `apps/demo/golden/`). The replay half needs recorded Jev fixtures, which need a key: a human runs `MORPH_PROVIDER=jev MORPH_RECORD=1 TYPESAFE_API_KEY=… pnpm test:golden:live` once, commits `fixtures/replay/`, and the `[replay]` tests then run the same expectations. Until then they report `[replay: no fixtures]` and only check the UI is never blank. Rules outcomes: G01 auto by_time, G02 auto by_customer, G03 refine recoverable, G04 confirm action (medium risk, uncalibrated), G05 auto period_vs_period, G06/G07 clarify, G08 stay, G11 alternates (separation 1.01), G12 override with 0 calls, G13 confirm.

## M5 — Talk-to-UI demo ✅ done
- [x] The 4-turn script (§1) works end to end with no keys, with animated morphs and no page reloads.
- [x] Alternates and undo work.

Notes: `app/page.tsx` → `components/demo/TalkToUI.tsx`. Facts are computed in the browser from `/data/sales.csv` (copied by `scripts/prepare.mjs`); only lens states go to `/api/morph/decide` through `RemoteProvider`. `e2e/talk-to-ui.spec.ts` runs the script, alternates + undo, the inspector and a no-sideways-scroll check at desktop and 360 px (12/12 e2e green). Two bugs found on the way: `RemoteProvider` called the global `fetch` with itself as `this` (browsers throw "Illegal invocation"; fixed + regression test), and Tailwind did not scan `packages/react` (added `@source` in `globals.css`).

## M6 — Narrative tier ✅ done
- [x] Unverified claims never reach the UI.
- [x] Slots are never blank with `MORPH_NARRATIVE_PROVIDER=none`.
- [ ] HUMAN: check the narrative with a real LLM key (`MORPH_NARRATIVE_PROVIDER=anthropic|openai`).

Notes: route and tests by agent A (`lib/server/narrate.test.ts`); verifier tests in core `narrative/`. The client (`lib/narrative/client.tsx`) only renders claims the route returns after `verifyClaims`, and falls back to fact sentences.

## M7 — Inspector and evaluation ✅ done
- [x] Every golden trace renders in the inspector.
- [x] Metrics are unit-tested on synthetic event logs.

Notes: `packages/react/src/MorphInspector.tsx` (`MorphInspector`, `TraceView`, `MetricsView`, `MorphWhyThis`). Opens with `?inspect=1` or Ctrl+. and shows intent, answers with probability bars, beam, gate, policy, pruned leaves, diff, timings, models, session metrics and JSON export. The golden test renders `TraceView` for every trace of every scenario. Metrics tests: `packages/core/src/trace/trace.test.ts`.

## M8 — Release prep ✅ done (agent scope)
- [x] A packed `@morph/core` installs into a fresh app and resolves a rules-only workspace.
- [ ] HUMAN: The demo is deployed on Vercel: replay by default, Jev via env. (Config is ready: `apps/demo/vercel.json`, steps in `docs/deploy.md`.)
- [ ] HUMAN: confirm the `@morph` npm scope is ours before the first publish (ADR 0005), then publish.

Notes: tsdown builds `packages/core` and `packages/react` (ESM + `.d.ts`) with `publishConfig.exports` → `dist/` (ADR 0005). `pnpm check:pack` (G8) packs `@morph/core`, installs it with npm in a temp app and resolves a rules-only workspace: `OK auto investigation.by_time`. Changesets (core and react versioned together, demo ignored, initial minor changeset). shadcn registry `apps/demo/registry.json` → `public/r/` during `pnpm build`, with a test that every component and file is listed. Upstash REST rate limiter (no SDK) is used when `UPSTASH_REDIS_REST_URL` and `_TOKEN` are set, and falls back to memory. Added `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `docs/llms.txt`, `docs/deploy.md`, package READMEs.

## M5 data layer (merged from agent B)
See `docs/progress-agent-b.md`: generator, committed `sales.csv`, `tsFactsEngine` with story tests (−17.1%, Enterprise 93% of the change, 7 recoverable).

## Parallel work (user asked for two extra agents, 2026-09-27)
- Agent A thread: demo server routes (`/api/morph/decide`, fixtures compile, rate limit) and `/api/morph/narrate`. Status in `docs/progress-agent-a.md`.
- Agent B thread: M5 data layer (`generate-sales.ts`, `data/sales.csv`, `lib/facts` tsFactsEngine). Status in `docs/progress-agent-b.md`.

## Post-MVP (SPEC §15), started 2026-09-27
The user asked for the §15 backlog in order, one PR per feature, with no new runtime dependencies.

### CSV upload ✅ done (ADR 0006)
- [x] "Use your own CSV" in the demo parses a file in the browser and suggests a column mapping.
- [x] Uploaded rows go through the same facts engine; customer IDs are replaced by synthetic IDs and names stay under `untrusted` (I5).
- [x] Unit tests (`lib/facts/upload.test.ts`) and e2e (`e2e/csv-upload.spec.ts`, desktop and 360 px).

### Trace storage ✅ done (ADR 0007)
- [x] `batchingSink` buffers traces and events (latest version per trace, lens content dropped) and `httpTraceSend` posts them.
- [x] `RingBufferSink({ forward })` keeps the inspector working while forwarding to storage.
- [x] `/api/morph/traces` validates, rate limits and appends to `MORPH_TRACE_DIR` via `jsonlTraceStore`; without the env var it accepts and drops.
- [x] Checked by hand with `next dev` + `MORPH_TRACE_DIR`: two turns produced two stored traces.

### Threshold calibration ✅ done (ADR 0008)
- [x] Traces record `gate.risk` and `gate.confidence` (capped as the gate compared it) for auto/confirm outcomes.
- [x] `calibrateGate(traces, events)` suggests `autoThreshold` per model version and risk level, keeping risk levels ordered and never going below the observed data.
- [x] `pnpm calibrate [dir]` prints the report and the suggested config, and reminds to replay the goldens. It never edits config.

### Autoresearch and distilled classifier ✅ done in agent scope (ADR 0009)
The user picked "Both" on 2026-09-27, built against mocked models with no new dependencies.
- [x] Softmax classifier and hashed text features in plain TypeScript (`packages/core/src/research/`).
- [x] `researchTurns` labels logged turns from overrides, confirms and results; `MORPH_TRACE_LENS=1` keeps lens output in saved traces.
- [x] `runResearchRound`: proposals validated into `research.*` specs (closed options, no math, no duplicates), one Jev request per turn with only its lens state, kept only on held-out gain.
- [x] `DistilledProvider` answers from a trained model, refuses unknown or changed specs so the chain falls back; wired in `selectProvider` before rules and as `MORPH_PROVIDER=distilled`.
- [x] Checked by hand: 28 saved turns → `pnpm distill --teacher any` → the demo ran two turns on `distilled` with no fallbacks; `pnpm research --dry-run` ran.
- [ ] HUMAN: run `pnpm research` with `TYPESAFE_API_KEY` and an LLM key on real traces, and review the report.

### §15 later scope
Adaptive navigation, workflows, Vue/Svelte adapters, protocol schema and MORPH Cloud are not started.

## Next step
All MVP agent-scope work is done. Remaining items are human-only: record replay fixtures with a Jev key, check the narrative with a real LLM key, deploy to Vercel, confirm the npm scope and publish. See `docs/handoff.md`.

## Open questions for a human
- none
