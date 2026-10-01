# 0010 — turn_type boundary cases

## Context
The first live Jev recording (jev-1.13.0) misread two turns of the 4-turn script. "What should I do?" was
answered `unclear` (0.70), so the gate asked to clarify instead of opening the recommendations view (G04).
Repeating "Why did revenue fall?" while the investigation was already open split `new_topic` 0.50 vs
`refine_current` 0.46, so confidence fell below the floor and the gate clarified instead of staying (G08).
SPEC §7.5 asks for boundary cases in option descriptions (§7 rule 2).

## Decision
Reword two `turn_type` option descriptions in `apps/demo/lib/morph/specs.ts`: `new_topic` now names general
"what should I do / what next" requests and repeated requests, and `unclear` says such questions are not
unclear. Gate thresholds, policies and golden expectations are unchanged.

## Consequences
- Text differs from the SPEC §7.5 sketch. Spec IDs, options and kinds are the same.
- Replay keys for `turn_type` change, so those fixtures must be re-recorded with `MORPH_RECORD=1`.
- If live Jev still misses these turns after re-recording, the next step is a human decision, not looser gates.
