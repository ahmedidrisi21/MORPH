# 0015 — Harden trace ingestion, and say what it cannot guarantee

## Context
`POST /api/morph/traces` (ADR 0007) stores the browser's decision traces and override events when
`MORPH_TRACE_DIR` is set. It had no authentication, accepted any extra fields (`z.looseObject`),
parsed the body whatever its content type, and capped nothing but the size of one request. The data
is not only archived: `pnpm calibrate` fits gate thresholds from it, `pnpm research` and
`pnpm distill` train on it (ADR 0008, 0009). Anyone who could reach the route could therefore fill
the disk, store arbitrary JSON, and feed forged outcomes to the tools that tune the gate.

A browser cannot hold a secret, so a shared token would not authenticate the demo's own uploads.
The data stays self-reported by the client.

## Decision
Make the route hard to abuse and the readers hard to fool, without pretending to authenticate:

- `DecisionTraceSchema`, `TimedEventSchema` and `TraceBatchSchema` in `morph-core` (`trace/schema.ts`):
  strict (unknown keys are rejected, so only expected fields are ever stored) and bounded (string
  lengths, array and record sizes, lens content depth, node count and string length, checked
  iteratively). `autoThreshold.critical` is `Infinity`, which JSON turns into `null`; the schema
  reads it back as `Infinity`. A compile-time check ties the schema to `DecisionTrace`, and the
  golden test parses every real trace through it, so a field added to the type without the schema
  fails a test.
- The route uses those schemas, and requires `Content-Type: application/json`. A cross-site form
  post (`text/plain`) would otherwise reach it without a CORS preflight.
- `jsonlTraceStore` takes `maxBytesPerDay`; a batch that would pass it is refused with
  `TraceStoreFullError` and the route answers 503. `MORPH_TRACE_MAX_DAY_MB` sets it (default 50).
- `readTraceStore` validates every trace and event with the same schemas and counts the rest as
  `skipped`, so `calibrate`, `research` and `distill` only read well-formed data, whoever wrote it.

## Consequences
- A client that sends a field the server does not know gets 400, so a new `DecisionTrace` field
  must be added to the schema in the same change (the golden test enforces it).
- Stored traces from before this change still read, because they match the same shape.
- **Still true:** a trace is the client's claim. Shape and size are checked, not whether a
  confidence or an override really happened, and per-IP rate limits can be spread across many IPs.
  Anyone who can post can still add plausible-looking outcomes. On a public deployment leave
  `MORPH_TRACE_DIR` unset (the Vercel demo does), or put the route behind your own authentication,
  and treat a threshold suggestion from stored traces as input for a human to review.
- No new runtime dependency (Zod is already one).
