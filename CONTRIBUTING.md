# Contributing to MORPH

Thanks for helping. The same rules apply to people and AI coding agents.

## Before you start
- Read [`AGENTS.md`](./AGENTS.md) (how to work) and [`SPEC.md`](./SPEC.md) (what to build).
- Check [`docs/progress.md`](./docs/progress.md) and [`docs/decisions/`](./docs/decisions/) for
  recent work and decisions.
- For a large change, open an issue first so we can agree on the approach.

## Setup
Node 22+ and pnpm (`corepack enable`).

```bash
pnpm install
pnpm dev        # demo at http://localhost:3000, no keys needed
pnpm verify     # lint + typecheck + unit tests + golden tests + boundary checks
pnpm test:e2e   # Playwright, desktop and 360 px (from apps/demo)
```

## Rules that reviews enforce
- `pnpm verify` is green before you open a PR.
- Behavior changes come with tests. Changes to decisions also come with a golden scenario in
  `fixtures/golden/`.
- Never loosen gate thresholds, policies, golden expectations or `scripts/goal-check.mjs` to get a
  green run.
- Keys stay on the server. No `eval`, `new Function` or `dangerouslySetInnerHTML`. No React, Next or
  DOM APIs in `packages/core`.
- Never hand-edit `fixtures/replay/`. Re-record it with `pnpm test:golden:live` and `MORPH_RECORD=1`.
- A new runtime dependency needs an issue first. New dev tooling needs an ADR.
- A deviation from the spec needs an ADR in `docs/decisions/NNNN-title.md`.

## Commits and releases
- Conventional prefixes: `feat(core):`, `fix(react):`, `test(golden):`, `docs:`, `chore:`.
- A PR that changes `morph-core` or `morph-react` adds a changeset (`pnpm changeset`).
- Maintainers publish and deploy (see [`docs/deploy.md`](./docs/deploy.md)).

## Conduct
Everyone taking part follows the [Code of Conduct](./CODE_OF_CONDUCT.md).
