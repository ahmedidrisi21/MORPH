# 0001 — Architecture

## Context

MORPH must change an application's interface in response to natural-language intent without generating frontend code (SPEC §1). Decisions must be bounded, inspectable, and safe to run with zero API keys.

## Decision

MORPH is a dual-process runtime (SPEC §3):

- **Tier 0 — Facts engine (code).** All numbers, buckets, filter sets and capability flags are computed in code.
- **Tier 1 — Fast shape.** Lenses select minimal state. A planner batches narrow decision specs (choice / score / noul) by lens-state hash so a user turn is one provider request. Providers: Jev (server only), Rules, Replay, Composite (fallback chain with a total budget), Remote (browser → `/api/morph/decide`). A resolver runs beam search over a workspace tree; policy prunes forbidden leaves; a deterministic gate (confidence, separation, hysteresis, cooldown) decides `auto | confirm | alternates | clarify | refine | stay`. Deterministic templates compose a `MorphUIState`, policy runs again per component, and props are Zod-validated. A diff drives Motion transitions.
- **Tier 2 — Slow words.** An optional LLM streams claims that cite fact IDs; code verifies every number before anything is shown. Without a key, code-generated fact sentences fill every slot.
- **Traces.** Every `resolve()` emits a `DecisionTrace`; overrides and confirmations are events. The Inspector reads a ring buffer.

Packages: `@morph/core` (framework-neutral; `./providers/jev` and `./node` are server-only subpaths), `@morph/react` (bindings), `apps/demo` (Next.js 16 Talk-to-UI demo).

## Consequences

- Model output is never authority; it only selects from closed option sets (I1, I2, I14).
- Keys stay server-side; the browser only sends lens states (a few hundred bytes) (I4, I8).
- Alternates and undo are local recompositions with no network call (I12).
- Boundaries are enforced by Biome, `tsconfig` libs, and `scripts/check-boundaries.mjs` (I7).
