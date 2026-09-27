# 0007 — Local trace storage before Supabase and PostHog

## Context
SPEC §15 describes trace storage as a Supabase `TraceSink` plus PostHog experiments. Neither is in
the §4 dependency list, both need accounts and keys, and AGENTS.md rules out cloud services in the
MVP. On 2026-09-27 the user chose "no new dependencies" for the post-MVP work. Threshold
calibration (the next §15 item) needs stored traces to fit against.

## Decision
- Core gets `batchingSink` (buffers traces and timed events, sends the latest version of each
  trace, flushes on size or delay, never throws into the runtime), `httpTraceSend` (POSTs a
  `TraceBatch`) and `redactTrace` (drops lens-state content). `RingBufferSink` gains an optional
  `forward` sink so the inspector keeps its in-memory copy. All additions; nothing existing
  changes shape.
- `@morph/core/node` gets `jsonlTraceStore(dir)` (one `traces-YYYY-MM-DD.jsonl` per UTC day,
  append-only) and `readTraceStore(dir)` (latest version per trace, skips malformed lines).
- The demo adds `POST /api/morph/traces`: Zod-validated, 512 KB limit, its own rate-limit key
  space. It stores only when `MORPH_TRACE_DIR` is set (a new optional env var); otherwise it
  accepts and drops, and the page does not attach the uploading sink at all.
- Stored traces never include lens content, even with `MORPH_DEV_TRACE_FULL=1` (I4). They do
  include the user's typed intent, as the in-memory traces already do.

## Consequences
- Works on a single server or locally. Serverless hosts with read-only disks (Vercel) should
  leave `MORPH_TRACE_DIR` unset until a hosted store exists.
- A Supabase or PostHog store only needs to implement `send(batch)`, or a server-side
  `TraceStore.append(batch)`, once a human approves the dependency.
