# 0005 — Release packaging and the npm scope

## Context
SPEC §14 M8 asks for tsdown builds with an exports map, Changesets, a shadcn registry, and an npm
scope check before any publish. Inside the monorepo, the demo and tests import package sources
directly (`exports` → `./src/*.ts`), which keeps `next dev` and Vitest fast and needs no build step.

## Decision
- `packages/core` and `packages/react` build with tsdown (ESM + `.d.ts`) into `dist/`. The source
  `exports` stay for workspace use, and `publishConfig.exports` points at `dist/` for `pnpm pack`
  and `pnpm publish`. `files` ships only `dist/`, the README and the license.
- `scripts/check-pack.mjs` (G8, `pnpm check:pack`) packs `@morph/core`, installs the tarball with
  npm into a temp app, checks every subpath has built JS and types, and resolves a rules-only
  workspace there.
- Changesets version `@morph/core` and `@morph/react` together (`fixed`) and ignore the private
  demo. `changeset init` crashes on Node 22 in this environment (an unsettled top-level await in
  the CLI's prompt), so `.changeset/config.json` was written by hand against the
  `@changesets/config@4.0.1` schema. `changeset status` accepts it.
- The shadcn registry lives in `apps/demo/registry.json`, and `shadcn build` runs during the demo
  build to emit `public/r/*.json`. Items use the `@morph/` namespace, so users add
  `"registries": { "@morph": "<demo URL>/r/{name}.json" }` to `components.json`. `MorphPayroll` is
  left out: it exists only to show a policy denial.
- `shadcn` (CLI 4), `tsdown` and `@changesets/cli` are dev dependencies listed in SPEC §4.
- The Upstash rate limiter calls the Upstash REST API with `fetch` instead of adding the Upstash SDK,
  because SPEC §4 lists Upstash as "interfaces only" for the MVP.

## npm scope
`npm view @morph/core` and `npm view @morph/react` return 404, so those package names are unused.
Whether the `@morph` scope is owned by someone else could not be checked from the build
environment: npmjs.com is not reachable there, and scope ownership needs a logged-in npm account.
Checking it is a human step before the first publish. If the scope is taken, rename the packages
in `packages/*/package.json`, the `@morph/*` imports, `registry.json` and this ADR, then run
`pnpm verify`.

## Consequences
- A release needs `pnpm build` before `pnpm pack`. `check:pack` does both.
- `dist/` and `apps/demo/public/r/` are build output and are ignored by git.

## Update
The `@morph` scope turned out to be taken (npm refused the username `morph`). The packages were
renamed to `morph-core` and `morph-react`; see ADR 0012.
