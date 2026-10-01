# 0004 — Demo server routes: decide and narrate

## Context

SPEC Appendix B defines `/api/morph/decide`, and SPEC §12 defines `/api/morph/narrate` but not its wire format. Both run server-side with keys (I8), must work with zero keys (I9), and must never trust client input.

## Decision

- **Decide** (`apps/demo/lib/server/decide.ts`, route in `app/api/morph/decide`). Body ≤ 32 KB, 1–8 batches of 1–40 specs, Zod-validated; every spec is re-validated with `validateSpecs` and must be one the app defines (`lib/morph/known-specs.ts`): static specs must match exactly, and `ws.*` tree questions must match the tree question's instructions with a subset of its options (pruning removes options). The response is Appendix B's `{ answers, provider, model, fallbacks }` plus `attempts` (the `ProviderAttempt[]` that `RemoteProvider` already reads for the trace). Errors return `{ error: { code, message } }` with no stack traces.
- **Provider selection** (`lib/server/providers.ts`). `replay` (default) → `Composite[Replay(memory store of compiled fixtures), Rules]`; `jev` with `TYPESAFE_API_KEY` → `Composite[Jev, Rules]`, with Jev wrapped in `ReplayProvider` record mode (fs store) when `MORPH_RECORD=1`; `jev` without a key falls back to replay with a warning; `rules` → `RulesProvider`. Replay keys always use the Jev identity (`provider: "jev"`, pinned `MORPH_JEV_MODEL`), because fixtures are recorded from Jev.
- **Fixtures** are compiled by `apps/demo/scripts/compile-fixtures.mjs` into `lib/morph/fixtures.generated.json` (sorted, committed). `dev` and `build` run it first; pnpm does not run `pre*` scripts by default, so it is chained explicitly.
- **Rate limit.** In-memory per-IP token bucket (decide: burst 20, 2/s; narrate: burst 40, 4/s), keyed by the first `x-forwarded-for` hop.
- **Narrate wire format.** `POST { slotId, intent, facts: Fact[] }` (≤ 20 facts). By default the reply is one JSON object `{ slotId, source, claims, claimsIn, claimsKept, dropped, actionIds }`, which `lib/narrative/client.tsx` reads. With `accept: application/x-ndjson` it streams instead: one `{ type: "claim", claim, source: "ai" | "facts" }` line per claim that passed `verifyClaims`, then one `{ type: "done", slotId, claimsIn, claimsKept, dropped, fallback, actionIds }` line for the trace. Claims are verified as soon as the next one starts streaming, so the first verified claim arrives early. At most 4 claims are considered. `actionIds` are filtered to the registered enum (`ACTION_IDS` in `lib/morph/registry.ts`). When the provider is `none`, misconfigured, errors, or no claim survives, the facts' own sentences are sent with `source: "facts"`, so a slot is never blank.
- **Narrative model.** AI SDK 7 `streamText({ output: Output.object({ schema }) })` and its `partialOutputStream`, with `@ai-sdk/anthropic` or `@ai-sdk/openai`. Model ID and key come from env; a missing value fails with a clear message and the route degrades to facts.

## Consequences

- The browser can only ask the server's key-holding provider the app's own questions.
- The decide response carries one extra field (`attempts`); clients that ignore it still match Appendix B.
- The existing JSON client keeps working; a streaming `MorphInsight` can opt into NDJSON for an earlier first claim.
