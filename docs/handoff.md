# Handoff

Date: 2026-09-27. Branch `claude/project-thread-tqrdne`, draft PR
[#1](https://github.com/yahyeameer/MORPH/pull/1). The goal check prints **GOAL MET (AGENT SCOPE)**
from a clean clone. What is left is human-only (listed below with commands).

## What was built
- **`morph-core`** (`packages/core`): facts types and buckets, the core lens with a token budget,
  decision specs and a planner that batches by lens state, an answer cache, providers (rules,
  replay, composite with fallback and time budget, remote, Jev on a server-only subpath), beam
  search over the workspace tree, the stability gate, policy, compose, diff, the narrative claim
  verifier, traces (ring buffer, metrics) and `createMorph` (resolve, override, confirm, undo).
  No React, Next or DOM. Coverage: 97% lines, 91% branches.
- **`morph-react`** (`packages/react`): `MorphProvider`, `MorphIntentBar`, `MorphAlternates`,
  `MorphWorkspace` (animated with `motion`), `MorphPending` (confirm and clarify), `MorphError`,
  `MorphInspector` (trace view, metrics, JSON export) and `MorphWhyThis`.
- **Demo** (`apps/demo`, Next 16): the Talk-to-UI sales dashboard. Facts are computed in the browser
  from the committed `data/sales.csv`, and only lens states go to `/api/morph/decide` (replay, then
  rules, or Jev with a key). `/api/morph/narrate` streams verified claims, or the page uses fact
  sentences. Includes the shadcn registry (`registry.json`), `/playground`, golden runner and e2e.
- **Release prep**: tsdown builds with publish exports, `pnpm check:pack`, Changesets, Upstash REST
  rate limiter, Vercel config, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `docs/llms.txt`,
  `docs/deploy.md`. ADRs 0001–0005 record the deviations and choices.
- **Tests**: 241 unit tests, 26 golden tests (G01–G13 on rules, replay probes), 12 Playwright tests
  (desktop and 360 px).

## Run the demo
```bash
pnpm install
pnpm dev                 # http://localhost:3000, no keys needed
```
Click the four suggestion chips in order. Add `?inspect=1` (or press Ctrl + .) to see each decision.

## Goal check (clean clone)
`git clone . /tmp/morph-check && cd /tmp/morph-check && pnpm install && pnpm goal:check`

```
| # | Check | Result | Detail |
|---|---|---|---|
| G1 | Clean install works | ✅ | pnpm install --frozen-lockfile exited 0 |
| G2 | Full verification | ✅ | pnpm verify exited 0 |
| G3 | Golden scenarios | ✅ | 13/13 pass on rules; 0/13 pass on replay |
| G4 | End-to-end demo | ✅ | Playwright 4-turn script, alternate and undo passed |
| G5 | Production build | ✅ | pnpm build exited 0 |
| G6 | No keys in the browser | ✅ | 13 static files scanned, no SDK code or keys |
| G7 | Core coverage | ✅ | packages/core lines 97.28% (≥85), branches 91.45% (≥80) |
| G8 | Package works standalone | ✅ | check-pack: OK auto investigation.by_time (morph-core-0.0.0.tgz) |
| G9 | No cheating | ✅ | 87 files scanned |
| G10 | No loose ends | ✅ | 78 source files scanned |
| G11 | Progress is complete | ✅ | M0–M8 marked done; every acceptance box checked or human-only |
| G12 | Docs match reality | ✅ | ran: git clone https://github.com/yahyeameer/MORPH.git → cd MORPH → pnpm install → pnpm dev |
GOAL MET (AGENT SCOPE) — waiting on human: M4: G01–G13 pass on replay, and on rules using `rulesExpect`.; M8: The demo is deployed on Vercel: replay by default, Jev via env.; check the narrative with a real LLM key (`MORPH_NARRATIVE_PROVIDER=anthropic|openai`).; confirm the `@morph` npm scope is ours before the first publish (ADR 0005), then publish.
```

## Human-only items still open
1. **Jev replay fixtures: recorded, G11 open.** Recorded with `jev-1.13.0` on 2026-10-01; 25 of 26 live runs
   pass. G11 ("look into customers and revenue") is left unrecorded, along with G12 which shares its first turn.
   Live Jev reads the request as customers (path confidence 0.54), so the gate clarifies where the golden
   expects two alternates. Decide whether to reword the tree questions in `apps/demo/lib/morph/tree.ts` or
   accept the live difference. To re-record after any wording change:
   ```bash
   export TYPESAFE_API_KEY=...          # never commit it
   MORPH_RECORD=1 MORPH_JEV_MODEL=jev-1.13.0 pnpm test:golden:live
   pnpm test:golden                     # replay runs now use the recorded fixtures
   ```
   Do not commit recordings that fail a golden: `pnpm verify` replays them. Live answers near the 0.5 floor
   vary between runs. If a scenario flips, lowering the floor is a human decision (ADR and approval).
2. **Check the narrative with a real LLM** (done 2026-10-01 with OpenRouter and Qwen3.8 27B; steps kept for re-checks): in `apps/demo/.env.local` set
   `MORPH_NARRATIVE_PROVIDER=anthropic`, `MORPH_NARRATIVE_MODEL=claude-haiku-4-5-20251001` and
   `ANTHROPIC_API_KEY=...`, run `pnpm dev`, ask "Why did revenue fall?" and check the insight panel
   shows the AI-generated tag and fact chips, with every number matching a fact.
   For OpenRouter (or any OpenAI-compatible server) use `MORPH_NARRATIVE_PROVIDER=openai`,
   `OPENAI_BASE_URL=https://openrouter.ai/api/v1`, `OPENAI_API_KEY=<your OpenRouter key>` and
   `MORPH_NARRATIVE_MODEL=<an OpenRouter model ID>`. A model that cannot return structured JSON makes the
   demo fall back to the fact-based sentences.
3. **Deploy to Vercel**: follow `docs/deploy.md` (root directory `apps/demo`, no env vars needed).
4. **Publish to npm** (done 2026-10-01 as `morph-core@0.1.0` and `morph-react@0.1.0`): the `@morph` scope
   is taken, so the packages are `morph-core` and `morph-react` (ADR 0012). For the next release, log in
   with `npm login` (the account needs two-factor login), then:
   ```bash
   pnpm changeset version && pnpm build && pnpm check:pack
   pnpm -r --filter "./packages/*" publish --access public
   ```

## Known limitations
- Without a Jev key, the demo runs on the rules provider. Rules only
  recognise phrasings close to the demo script and the goldens; other questions often end in a
  clarify prompt or keep the current view. Rules are marked uncalibrated (confidence capped at
  0.8), so "What should I do?" asks for confirmation before showing actions.
- Component IDs include the leaf ID (SPEC §11), so switching workspaces cross-fades cards rather
  than moving the ones both views share.
- G12 clones `https://github.com/yahyeameer/MORPH.git`, which checks the README on `main`. It checks
  this branch's README only after PR #1 is merged.
- Without Upstash env vars, rate limits are per server instance.
- `changeset init` crashes on Node 22 here (config written by hand, ADR 0005). tsdown warns that
  the TypeScript 7 declaration API is experimental; the pack check covers the output.
- The inspector is a fixed panel and covers part of the page while open.

## Suggested next steps (SPEC §15, not started)
- CSV upload ("Build me a dashboard") with a DuckDB-WASM facts engine and schema-driven templates.
- Trace storage (Supabase `TraceSink`) and fixed-vs-adaptive experiments.
- Gate threshold auto-calibration from traces per pinned model version.
- The autoresearch loop for new decision questions, and a distilled per-app classifier for
  offline use.
