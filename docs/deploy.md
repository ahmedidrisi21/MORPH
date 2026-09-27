# Deploying the demo (Vercel)

Deploying is a human step (GOAL.md §5). This page lists everything needed.

## One-time setup
1. Import `yahyeameer/MORPH` in Vercel and set **Root Directory** to `apps/demo`. Vercel detects the
   pnpm workspace and Next.js. `apps/demo/vercel.json` pins the install and build commands.
2. Node.js version: 22 or later.
3. No environment variables are needed. The demo then runs on replay fixtures with a rules fallback,
   and insights use code-generated sentences.

## Optional environment variables
Set these in the Vercel project (Production and Preview). They are read on the server only.

| Variable | Effect |
|---|---|
| `MORPH_PROVIDER=jev` + `TYPESAFE_API_KEY` | Live Jev decisions. Keep `MORPH_JEV_MODEL` pinned (for example `jev-1.13.0`). |
| `MORPH_NARRATIVE_PROVIDER=anthropic` or `openai`, `MORPH_NARRATIVE_MODEL`, and the matching API key | LLM-written insights, verified against facts before display. |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | Shares the per-IP rate limit across serverless instances. Without them, each instance limits on its own. |

Never set `MORPH_RECORD=1` or `MORPH_DEV_TRACE_FULL=1` in a deployment.

## Check after deploy
- `/` loads the sales overview, and the four suggestion chips run the script from the README.
- `/?inspect=1` opens the inspector. With no keys, the batches show `replay` or `rules`.
- `/r/registry.json` serves the shadcn registry (built by `shadcn build` during `pnpm build`).

## Publishing packages (npm)
Also human-only. Before the first publish, confirm the `@morph` npm scope (see
`docs/decisions/0005-release-packaging.md`). Then:

```bash
pnpm changeset          # describe the change
pnpm changeset version  # bump versions and write changelogs
pnpm build && pnpm check:pack
pnpm -r --filter './packages/*' publish --access public
```
