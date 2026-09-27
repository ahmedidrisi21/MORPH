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
and `readTraceStore` in `@morph/core/node`, and the demo's `/api/morph/traces` route behind
`MORPH_TRACE_DIR`. Still open: a Supabase store and PostHog experiments, which need a human to
approve the dependencies and provide accounts.

## threshold-calibration {#threshold-calibration}
Fit gate thresholds from traces per pinned model version; replay the goldens before any model upgrade.

## autoresearch {#autoresearch}
LLM-proposed decision questions answered by Jev over logged turns; a small classifier trained on the probabilities with overrides as labels.

## distilled-classifier {#distilled-classifier}
Per-app distilled classifier for offline/edge mode.

## later-scope {#later-scope}
Adaptive navigation, adaptive workflows, Vue/Svelte adapters, protocol schema, MORPH Cloud.
