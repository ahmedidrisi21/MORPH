# 0011 — turn_type: new topic versus refinement

## Context
After ADR 0010, live Jev (jev-1.13.0) passed G04 and G08. The second recording still scored the first turn from
the overview screen low: "Compare this quarter with last quarter." gave `new_topic` 0.66 against
`refine_current` 0.34 (confidence 0.48, below the 0.5 floor), and an earlier "Why did revenue fall?" run fell
below the floor the same way. The overview already shows some of the same numbers, so the model sometimes
read a new analysis as a narrowing of the current view. The same input also scored differently across runs.

## Decision
Make the boundary explicit in two `turn_type` option descriptions in `apps/demo/lib/morph/specs.ts`:
comparisons, why-questions and show-me requests are new topics even when the workspace shows some of the same
numbers, and asking for a different kind of analysis is never a refinement. The gate floor, thresholds,
policies and golden expectations are unchanged.

## Consequences
- Replay keys for `turn_type` change again, so those fixtures must be re-recorded with `MORPH_RECORD=1`.
- Recordings that still fail a golden must not be committed to `fixtures/replay`: `pnpm verify` replays them.
- Live Jev answers vary between runs near the floor. If a scenario still flips after this change, lowering the
  floor is a human decision (ADR and approval), not a test edit.
