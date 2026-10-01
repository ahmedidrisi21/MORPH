# 0016 — Record narrative outcomes in traces

## Context
SPEC §12 puts claims in, claims kept and drop reasons in the trace, but `trace.narrative` was always `[]`. The narrate route also lost provider errors: `streamText` swallows them, so a bad key looked like "the model wrote nothing".

## Decision
- Add `Morph.recordNarrative(traceId, record): boolean` and the `NarrativeRecord` type (with optional `source: "ai" | "facts"`). It replaces the record for the same slot, caps at 50 per trace, and returns false for an unknown trace.
- The client hook records the result after each narrate call, including request failures.
- `createClaimStreamer` records `onError` and rethrows after the stream ends. The route turns it into `provider error (<status>)` and never forwards the message.
- `summarize` gains `narrative` metrics; the inspector shows them.
- Add a claim corpus as tests that pin today's verifier behavior and list its gaps. It does not change the verifier.

## Consequences
- Additive public API only. The trace schema accepts the new `source` field.
- Narrative failures are now visible in metrics instead of silent.
- Traces remain self-reported by the browser.
- Closing the verifier gaps needs a human decision (claim format, Jev data flow, fail closed or open).
