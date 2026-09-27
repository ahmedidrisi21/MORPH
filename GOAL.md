# GOAL — Ship the MORPH MVP

## 1. The goal

Ship the MORPH MVP: the open-source adaptive UI runtime (`@morph/core`, `@morph/react`) and the Talk-to-UI demo. Every milestone M0–M8 in `SPEC.md` §14 must be complete, and `pnpm goal:check` must print `GOAL MET`.

In plain words, when the goal is met, anyone can:

- clone the repo, run `pnpm install && pnpm dev` with no API keys, and open the demo;
- type the 4-turn script and watch the workspace morph each time, with no page reload: "Why did revenue fall?" → "Show me the customers." → "Only show customers I can save." → "What should I do?";
- pick an alternate layout or undo, and see the change instantly;
- open the Inspector and see why every view was chosen;
- add `TYPESAFE_API_KEY` and get live Jev decisions with no code changes.

## 2. The finish line: `pnpm goal:check`

`scripts/goal-check.mjs` runs every check below in order, prints a ✅/❌ table, and ends with exactly one of these lines:

- `GOAL MET — every check passed.`
- `GOAL MET (AGENT SCOPE) — waiting on human: <items>` — everything passed except the human-only items in §5.
- `GOAL NOT MET — next: <first failing check>`

| # | Check | How it is verified |
|---|---|---|
| G1 | Clean install works | `pnpm install --frozen-lockfile` exits 0 |
| G2 | Full verification | `pnpm verify` exits 0 (lint, typecheck, unit tests, golden tests, boundary check) |
| G3 | Golden scenarios | G01–G13 from SPEC §13.3 pass on RulesProvider, and on ReplayProvider where fixtures exist |
| G4 | End-to-end demo | `pnpm test:e2e` (Playwright) runs the 4-turn script, an alternate, and undo with no keys |
| G5 | Production build | `pnpm build` exits 0 for all packages and the demo |
| G6 | No keys in the browser | scan `apps/demo/.next/static`: no `@typesafe-ai/sdk`, no `@ai-sdk/`, no `TYPESAFE_API_KEY`, no `sk-` strings |
| G7 | Core coverage | Vitest coverage for `packages/core` ≥ 85% lines and ≥ 80% branches |
| G8 | Package works standalone | `scripts/check-pack.mjs` packs `@morph/core`, installs it in a temp project, and resolves a rules-only workspace |
| G9 | No cheating | no `.skip`, `.only`, `xit`, `@ts-ignore`, or `biome-ignore` in `packages/*/src` or tests, unless an ADR justifies that exact line |
| G10 | No loose ends | no TODO/FIXME in `packages/*/src` unless the line references an entry in `docs/backlog.md` |
| G11 | Progress is complete | `docs/progress.md` marks M0–M8 done, with every acceptance box from SPEC §14 checked |
| G12 | Docs match reality | the README quickstart commands run as written (the script executes them) |

Never edit `goal-check.mjs` to make a failing check pass. You may only add checks or make existing ones stricter. Loosening a check needs an ADR and human approval.

## 3. The work loop (repeat until GOAL MET)

1. Read `docs/progress.md` → find the current milestone and the next unchecked item.
2. Plan the smallest change that moves one acceptance item forward (note it in `progress.md`).
3. Implement it, writing tests first where practical.
4. Run `pnpm verify`. Red → fix and re-run (see §4 if stuck). Green → commit (conventional commit message).
5. When every acceptance item of the milestone is met: run `pnpm goal:check`, paste the result in `progress.md`, mark the milestone done, and move to the next milestone.
6. Every ~5 commits, or before your context runs low: update `progress.md` so a brand-new session can continue with no other context.
7. If `pnpm goal:check` prints GOAL MET → go to §6 (Finishing). Otherwise → loop.

Do not stop between milestones to ask for permission. Moving from M3 to M4 is expected, not a decision. Keep going until the goal is met or a hard stop (§5) applies.

## 4. When stuck

- The same check fails after 3 honest attempts → write the error, what you tried, and your hypothesis in `docs/blockers.md`.
- Try one genuinely different approach (a simpler implementation, or a library API re-checked against the types in `node_modules`).
- Still failing → mark the item BLOCKED in `progress.md` and continue with the next item that does not depend on it.
- If every remaining item is blocked → hard stop (§5): report the blockers and wait.

A blocker is never a reason to weaken a test, threshold, invariant, or golden scenario.

## 5. Hard stops and human-only items

Stop and ask a human when:

- a change would violate an invariant in SPEC §2;
- you need a runtime dependency not listed in SPEC §4;
- a public API in SPEC §6–§11 must change;
- a golden scenario looks wrong, rather than the code;
- everything remaining is blocked (§4).

Human-only items. Prepare everything for these, but never do them yourself:

| Item | What you prepare | What the human does |
|---|---|---|
| Live Jev fixtures | recording script, mocked-fetch tests for JevProvider, instructions in `progress.md` | sets `TYPESAFE_API_KEY` and runs `MORPH_RECORD=1 pnpm test:golden:live` |
| LLM narrative check | narrate route, verifier, and tests with a mocked model | sets the narrative env vars and tries the demo |
| Deploy | Vercel config and a checklist in `docs/deploy.md` | connects the repo and deploys |
| Publish to npm | builds, Changesets, npm scope check result | confirms scope and license, then publishes |

Never create, request, print, or commit secrets. Never publish or deploy.

When only human-only items remain, `pnpm goal:check` prints `GOAL MET (AGENT SCOPE) — waiting on human: …`. Treat that as your finish line. Human-only acceptance items are written in `docs/progress.md` as `- [ ] HUMAN: <item>`.

## 6. Finishing

When `pnpm goal:check` prints GOAL MET or GOAL MET (AGENT SCOPE):

1. Re-run it from a clean clone: `git clone . /tmp/morph-check && cd /tmp/morph-check && pnpm install && pnpm goal:check`
2. Write `docs/handoff.md` with: what was built; how to run the demo; the full goal:check output; the human-only items still open, with the exact commands to run; known limitations; suggested next steps from SPEC §15.
3. Stop. Do not start post-MVP backlog work.

## 7. Starting prompt

> Read GOAL.md, AGENTS.md and SPEC.md fully. Then read docs/progress.md if it exists. Work the loop in GOAL.md §3 until pnpm goal:check prints GOAL MET or GOAL MET (AGENT SCOPE), or until a hard stop in GOAL.md §5 applies. Do not ask me for permission between milestones. Keep docs/progress.md current so any session can resume.
