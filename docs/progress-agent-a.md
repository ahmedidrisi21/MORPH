# Progress — parallel agent A (demo server side)

Branch: `claude/project-thread-gwyl3b` (based on `claude/project-thread-tqrdne` @ 9132d81). The main thread owns `docs/progress.md`; merge these notes into it.
Updated: 2026-09-27

## Done
- `apps/demo/lib/morph/specs.ts` (SPEC §7.5 decision set), `tree.ts` (§8.1 MVP tree), `rules.ts` (rules for every static spec and every `ws.*` question), `known-specs.ts` (allowlist for the route). Narrate uses `ACTION_IDS` from the main thread's `lib/morph/registry.ts`.
- `/api/morph/decide` (Appendix B): `lib/server/decide.ts` + `providers.ts` + `rate-limit.ts`; fixtures prebuild `scripts/compile-fixtures.mjs` → `lib/morph/fixtures.generated.json`, run by `dev` and `build`.
- `/api/morph/narrate` (§12): `lib/server/narrate.ts` + `narrative-model.ts` (AI SDK 7 structured streaming). Added `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai` to the demo (SPEC §4).
- ADR `docs/decisions/0004-demo-server-routes.md` (renumbered from 0002 on merge).
- Tests: `lib/morph/rules.test.ts`, `lib/server/{decide,narrate,rate-limit}.test.ts` (38 tests).

## Acceptance items this moves
- M3: "With a key and `MORPH_PROVIDER=jev`, one user turn issues exactly one `systemOne` request": tested end to end through the decide handler with the SDK's injectable `fetch` (`decide.test.ts`).
- M3: "Without a key, the demo runs on replay/rules": decide answers every spec with zero keys (replay miss → rules), tested.
- M3: "The client bundle contains no SDK code or keys": `pnpm --filter @morph/demo build` then the G6 scan finds nothing in `.next/static`.
- M6: "Unverified claims never reach the UI" (server side) and "Slots are never blank with `MORPH_NARRATIVE_PROVIDER=none`": tested in `narrate.test.ts`. The route answers the main thread's `lib/narrative/client.tsx` JSON contract (`{ claims, source }`) by default, and streams NDJSON when asked.

## Verification
- `pnpm typecheck`, `pnpm test` (all green), `pnpm test:golden`, `pnpm check:boundaries`, `pnpm build` for the demo: green.
- `pnpm lint` is red only on the base branch's `packages/react/src/MorphAlternates.tsx:9` and `MorphIntentBar.tsx:46` (`aria-label` on a plain `div`), which the main thread owns. Biome is clean on everything this branch adds.

## Not done / next
- Record G01–G13 replay fixtures: human-only (`TYPESAFE_API_KEY` + `MORPH_RECORD=1 pnpm test:golden:live`), needs the M4 golden runner first.
- Wire `RemoteProvider({ url: "/api/morph/decide" })` in the demo page (main thread, M5). Optionally switch the narrative client to NDJSON streaming (M6).

## Open questions for a human
- none
