# 0009 — Autoresearch round and distilled classifier in plain TypeScript

## Context
SPEC §15 lists an autoresearch loop (an LLM proposes decision questions, Jev answers them over
logged turns, a small classifier trains on the probabilities with overrides as labels) and a
distilled per-app classifier for offline mode. The user chose "no new dependencies" and asked for
both, built against mocked models. The invariants still apply: model output is never authority
(I1), models only fill closed option sets (I2), no math in questions (I3), providers see only
lens output (I4), and the narrative LLM never picks layouts (I14).

## Decision
- `packages/core/src/research/`: a deterministic softmax regression (`trainSoftmax`), hashed
  word and word-pair features over a lens state's strings (`stateTextFeatures`), answer
  features (`answerFeatures`), `researchTurns` (labels from overrides, accepted confirms, and
  auto/refine/stay results), and `specsFromAnswers` for tools without the app's spec file.
- `runResearchRound` trains on answers the turns already have, shows the misclassified turns to a
  `QuestionProposer`, and validates its JSON with `validateProposals`: `research.`-prefixed IDs,
  `choice` (2–8 snake_case options) or `noul` only, at most 400 characters, no duplicates, and no
  arithmetic words (I3). Valid proposals go through `validateSpecs`. Jev answers them with one
  request per turn carrying only that turn's lens state (I4). A question is kept only if held-out
  accuracy (a fixed hash split) rises by `minGain`. The result is a report; adding a kept question
  to the app is a human decision. The proposer only writes questions, never UI (I14).
- `trainDistilled` fits one classifier per spec, weighted by the teacher's confidence.
  `DistilledProvider` is uncalibrated (the gate caps it) and throws `ProviderError` for any spec it
  was not trained on or whose options changed, so a `CompositeProvider` falls back (I11).
- Saved traces keep lens content only with `MORPH_TRACE_LENS=1` (needs `traceFull` in the
  browser and `keepLensContent` on the sink and store). Lens output is what providers already
  receive; it never holds rows or customer names.
- CLIs: `pnpm research [dir] [--dry-run]` (Jev + the `MORPH_NARRATIVE_*` LLM through the `ai`
  SDK) and `pnpm distill [dir] [--out] [--teacher any]`. The demo reads `MORPH_DISTILLED_MODEL`
  and supports `MORPH_PROVIDER=distilled`.

## Consequences
- No real round has run yet; that needs keys (human-only). Rules-answered traces are perfectly
  predictable, so a dry run shows no errors to learn from.
- The classifier is intentionally small (full-batch gradient descent, no dependencies). If
  datasets grow large, training time grows linearly with turns × features × epochs.
- Research questions start with `research.` so they can never collide with app specs.
