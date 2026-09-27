# AGENTS.md — Operating rules for AI coding agents

You are building **MORPH**, an open-source adaptive UI runtime. `SPEC.md` defines *what* to build. This file defines *how* to work. Read both fully before writing code.

## Read order
1. `AGENTS.md` (this file)
2. `SPEC.md` §0–§2 (process, scope, invariants), then the section for your current milestone
3. `docs/progress.md` and the latest ADRs in `docs/decisions/` (what previous sessions did)

## Workflow
- Work on **one milestone** from `SPEC.md` §14 at a time, in order. Find the current one in `docs/progress.md`.
- Before coding, write a short plan (files to create or change, tests to add) in your first message or in `docs/progress.md`.
- Make small, reviewable commits. Use conventional prefixes: `feat(core):`, `fix(react):`, `test(golden):`, `docs:`, `chore:`.
- Finish every task by running `pnpm verify`. Never report done while it is red.
- Record deviations from the spec as ADRs: `docs/decisions/NNNN-title.md` with Context, Decision, and Consequences.
- At the end of a session, append to `docs/progress.md`: what was done, what is next, open questions.

## Commands
```
pnpm install
pnpm dev                 # demo at http://localhost:3000 (works with no API keys)
pnpm test                # unit tests (Vitest)
pnpm test:golden         # golden scenarios on replay + rules providers
pnpm test:golden:live    # real Jev; needs TYPESAFE_API_KEY; MORPH_RECORD=1 refreshes fixtures
pnpm check:boundaries    # package boundary + forbidden API scan
pnpm verify              # lint + typecheck + test + test:golden + check:boundaries
```

## Hard rules (see SPEC §2 for the full invariant list)
- Never call Jev or an LLM from browser code. Never set `dangerouslyAllowBrowser`. Keys stay server-side.
- Never use model aliases such as `jev-latest`. Use the pinned model ID from `MORPH_JEV_MODEL`.
- Never send raw rows or the full context to a provider. Only lens output (SPEC §6.2).
- Never do math, counting, or date logic in a model question. Compute it in the facts engine.
- Never render model output as markup or code. No `eval`, `new Function`, or `dangerouslySetInnerHTML`.
- Never import React, Next, or DOM APIs in `packages/core`.
- Never import `@morph/core/providers/jev` or `@morph/core/node` from client code.
- Never let the narrative LLM choose layouts, components, filters, or free-form actions.
- Never loosen gate thresholds, policies, or golden expectations to make tests pass.
- Never hand-edit `fixtures/replay/`. Re-record with `pnpm test:golden:live` and `MORPH_RECORD=1`.
- Never add runtime dependencies outside SPEC §4 without asking. Dev tooling needs an ADR.
- Never install `framer-motion`. Use `motion` with `import … from "motion/react"`.
- Do not add a database, auth, or cloud service in the MVP.

## Code conventions
- TypeScript strict. No `any` in public APIs. Use `unknown` and narrow.
- Pure functions for lenses, planner grouping, beam search, gate, policy, compose, diff, and verifier. Inject `clock` and `idGen` so tests are deterministic.
- Zod schemas are the single source of truth for component props, specs, and route bodies. Derive types with `z.infer`.
- Each module exports from its folder's `index.ts`. `packages/core/src/index.ts` must not re-export the jev or node subpaths.
- Test files sit next to source as `*.test.ts`. Golden fixtures live in `/fixtures`.
- Errors thrown by providers extend `ProviderError`. `resolve()` never throws for provider failures.
- User-facing copy is plain and short. Demo components must work at mobile widths (≥ 360 px).

## Verifying library APIs
Several dependencies changed major versions recently (Next 16, AI SDK 7, Zod 4, Motion 13, TypeScript 7). Check signatures in `node_modules/<pkg>` types or official docs before using them. Do not rely on memory. The TypeSafe SDK mapping in SPEC Appendix A was verified against `@typesafe-ai/sdk@0.6.0`.

## When to stop and ask a human
- A change would violate an invariant or needs an unlisted runtime dependency.
- A golden scenario seems wrong rather than the code.
- A public API in SPEC §6–§11 needs to change.
- Anything involving secrets, publishing to npm, or deploying.

## Claude Code
`CLAUDE.md` imports this file. Keep project rules here so all agents share one source.
