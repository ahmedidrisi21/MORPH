# 0002 — shadcn-style UI primitives without extra runtime dependencies

Status: primitives superseded by ADR 0013 (real shadcn/ui). Charts still use Recharts directly.

## Context

SPEC §4 lists Tailwind CSS 4 + shadcn CLI 4, and §14 M1 asks for demo components "built on shadcn primitives". The shadcn CLI generates source files that depend on `class-variance-authority`, `clsx`, `tailwind-merge`, `@radix-ui/*` and `lucide-react`, none of which are in the §4 runtime dependency list. AGENTS.md forbids adding runtime dependencies outside §4 without a human.

## Decision

`apps/demo/components/ui/` contains hand-written primitives (`Card`, `Button`, `Badge`, `Table`, `Skeleton`) that follow shadcn/ui's structure, naming and `data-slot` attributes, styled with Tailwind 4, and use a local `cn()` helper instead of `clsx` + `tailwind-merge`. Charts use Recharts 3 directly (the library shadcn's chart wraps).

## Consequences

- No new runtime dependencies. Users who prefer the real shadcn components can swap these files in; the Morph components only use the primitive names and props shadcn also exposes.
- The M8 shadcn registry (`registry.json`) publishes the Morph components; their only dependencies are these primitives and Recharts.
