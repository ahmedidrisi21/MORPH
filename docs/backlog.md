# Backlog

Post-MVP work (SPEC §15). Source comments may reference an entry with `docs/backlog.md#<id>`.

## csv-upload {#csv-upload}
CSV upload / "Build me a dashboard": a DuckDB-WASM FactsEngine and schema-driven templates.

Status: first version done (ADR 0006). Uploads map onto the sales schema with papaparse and the
TypeScript facts engine. Still open: DuckDB-WASM for very large files, and templates for data that
is not order-shaped (no date, revenue or customer column).

## trace-storage {#trace-storage}
Supabase `TraceSink` and PostHog experiments comparing a fixed vs. adaptive dashboard.

Status: local storage done (ADR 0007). `batchingSink` + `httpTraceSend` in core, `jsonlTraceStore`
and `readTraceStore` in `morph-core/node`, and the demo's `/api/morph/traces` route behind
`MORPH_TRACE_DIR`. Still open: a Supabase store and PostHog experiments, which need a human to
approve the dependencies and provide accounts.

## threshold-calibration {#threshold-calibration}
Fit gate thresholds from traces per pinned model version; replay the goldens before any model upgrade.

Status: done as suggestions (ADR 0008). `calibrateGate()` in core, `pnpm calibrate` CLI. Traces now
record the gate's `risk` and compared `confidence`. Applying a suggestion stays a human decision.

## autoresearch {#autoresearch}
LLM-proposed decision questions answered by Jev over logged turns; a small classifier trained on the probabilities with overrides as labels.

Status: one round is built (ADR 0009): `runResearchRound()` in core and `pnpm research`. Not yet
run with real keys. Still open: running rounds on a schedule and carrying kept questions forward.

## distilled-classifier {#distilled-classifier}
Per-app distilled classifier for offline/edge mode.

Status: done (ADR 0009). `trainDistilled()` / `DistilledProvider` in core, `pnpm distill`, and
`MORPH_DISTILLED_MODEL` / `MORPH_PROVIDER=distilled` in the demo. Needs Jev-answered traces to be
useful; `--teacher any` trains on rules answers for local trials.

## later-scope {#later-scope}
Adaptive navigation, adaptive workflows, Vue/Svelte adapters, protocol schema, MORPH Cloud.
