# 0012 — npm package names

## Context
ADR 0005 planned to publish `@morph/core` and `@morph/react` and said to rename them if the `@morph`
scope was taken. A human tried to create the npm account `morph` on 2026-10-01 and npm said the
username is already taken, so the scope belongs to someone else. `@morph-ui/core` and `morph-ui`
are also taken. `morph-core` and `morph-react` returned 404 on the registry the same day.

## Decision
- Publish the packages as `morph-core` and `morph-react`, chosen by a human on 2026-10-01 over
  `@yahyeameer/morph-core`. Unscoped names need no npm organisation.
- Rename `@morph/core` and `@morph/react` everywhere they are imported or documented, including the
  subpaths `morph-core/node` and `morph-core/providers/jev`. The boundary check and the Biome import
  rules use the new names.
- Keep `@morph/demo` (private, never published) and the `@morph/` shadcn registry namespace. The
  registry namespace is a `components.json` setting and is unrelated to npm scopes.
- `SPEC.md`, `GOAL.md` and ADRs 0001, 0005 and 0007 keep the old names as a record of what was
  planned. This ADR is the current answer.

## Consequences
- Users install with `npm install morph-core morph-react`.
- Registry items list `morph-core` and `morph-react` as npm dependencies.
- The packages have no namespace, so a later move to a scope means a new package name.
