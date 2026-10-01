# 0013 — Real shadcn/ui primitives in the demo and registry

Supersedes the primitives part of ADR 0002.

## Context
ADR 0002 hand-wrote `Card`, `Button`, `Badge`, `Table` and `Skeleton` to avoid runtime
dependencies outside SPEC §4, and the registry shipped those files plus a `morph-utils` item that
wrote `lib/utils.ts`. A developer who already uses shadcn/ui would be asked to overwrite their own
`card.tsx` and `lib/utils.ts` with look-alikes, and the Morph components were never tested on the
real primitives. On 2026-10-01 a human chose real shadcn/ui in both the demo and the registry and
approved the extra demo-only packages.

## Decision
- `apps/demo/components.json` configures shadcn (Radix base, Vega preset, neutral colours, CSS
  variables). `components/ui/{card,button,badge,table,skeleton}.tsx` come from
  `npx shadcn add` unchanged apart from Biome formatting. `lib/utils.ts` re-exports `cn` as the
  CLI wrote it.
- The CLI added these demo dependencies: `class-variance-authority`, `cn` (shadcn's
  clsx + tailwind-merge replacement), `radix-ui`, `lucide-react` and `tw-animate-css`.
  `morph-core` and `morph-react` gain no dependencies.
- `app/globals.css` carries the shadcn theme tokens. The `next/font` Inter change the CLI made to
  `app/layout.tsx` was reverted so builds do not fetch Google Fonts.
- The registry no longer publishes `morph-utils`, `card`, `badge`, `button`, `table` or
  `skeleton`. Morph items list the official names (`card`, `table`, `badge`, `skeleton`, `button`,
  `utils`) in `registryDependencies`, so `shadcn add` installs them from ui.shadcn.com and skips
  files the developer already has.
- Morph components use only the official props. The demo's custom badge variant `ai` became a
  `className`, and cards use `size="sm"` with `pr-20` on the header for the "Why this?" button.

## Consequences
- The demo looks like stock shadcn/ui (neutral palette, shadcn buttons).
- Checked on 2026-10-01: in a fresh `shadcn init` Next app with an existing `card.tsx`,
  `npx shadcn add @morph/morph-kpi … @morph/morph-alert` created the Morph files and the missing
  primitives, skipped `card.tsx`, `button.tsx` and `lib/utils.ts`, and `tsc --noEmit` passed.
- `registry.test.ts` fails if the registry ships its own primitives again.
