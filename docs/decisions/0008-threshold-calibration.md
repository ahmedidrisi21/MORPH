# 0008 — Threshold calibration as suggestions

## Context
SPEC §15 asks to "fit gate thresholds from traces per pinned model version, and replay the
goldens before any model upgrade". SPEC §9 says thresholds are tuned from traces and never
edited to pass a test. Traces did not record which risk level or capped confidence the gate
used in step 8, so they could not be fitted without re-running the resolver.

## Decision
- `DecisionTrace.gate` gains optional `risk` and `confidence` for auto/confirm outcomes. The
  confidence is the value the gate compared: capped at `uncalibratedCap` for uncalibrated trees.
- `calibrateGate(traces, events, opts)` in core groups traces by `traceModel()` (the versioned
  model ID, or the provider name), and for each of low/medium/high risk finds the lowest
  threshold whose outcomes at or above it were kept at least as often as the target (90/95/99%),
  with at least `minSamples` (30) outcomes. An auto morph counts as kept unless it was overridden
  within 10 s; a confirm counts by the user's answer; unanswered confirms are ignored. The search
  never goes below the lowest observed confidence, riskier levels never get a lower threshold
  than safer ones, and `critical` stays at infinity.
- `pnpm calibrate` builds core and prints the report and a suggested `gate` config. It changes
  nothing. Applying a suggestion is a human decision, after `pnpm test:golden` (and re-recording
  replay fixtures for a new model version).

## Consequences
- Only outcomes the gate allowed (auto or confirm) are observed, so the fit can only use evidence
  from the confirm band and above. This is conservative by design.
- Traces saved before this change have no `risk`, so they are counted per model but not fitted.
