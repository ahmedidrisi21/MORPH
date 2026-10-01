# MORPH

**Software that changes when you do.**

MORPH is an open-source runtime for building interfaces that adapt to what the user is trying to do. You define capabilities, components, data, and policies. MORPH turns natural-language intent into bounded, inspectable decisions, and transforms the workspace. It never generates frontend code.

> **Status: pre-alpha.** The runtime, React bindings and demo are built and tested (M0–M8 in [`SPEC.md`](./SPEC.md)), but nothing is published to npm yet and the APIs may change. Contributions welcome.

---

## The demo

A sales dashboard you can talk to:

```
You:   Why did revenue fall?
MORPH: → Revenue investigation (trend, period comparison, contributing segments)

You:   Show me the customers.
MORPH: → Customers driving the decline

You:   Only show customers I can save.
MORPH: → Same view, filtered to recoverable customers

You:   What should I do?
MORPH: → Recommended actions
```

Every change animates in place, with no page reloads. Runner-up layouts stay one tap away, and every decision can be inspected.

To try it on your own data, choose **Use your own CSV**. MORPH suggests which column is the order date, revenue and customer (plus optional segment, cost and order ID), and you can change any choice before building. The file is parsed in your browser and never uploaded; providers still see only the lens output.

---

## Why MORPH is different

| | Fixed UI | AI UI generators | **MORPH** |
|---|---|---|---|
| Who decides the layout | Developer, ahead of time | Model, by writing code | Model picks from options you defined |
| Output | Static pages | Generated code | Validated UI state → your components |
| Safety boundary | — | Hard to enforce | Schema → gate → policy → prop validation |
| Debuggable | Yes | Rarely | Every decision is traced |

### Core ideas

- **Small decisions, composed in code.** Instead of one giant prompt, MORPH asks many narrow questions (intent, workspace, filter, density) and composes the answers deterministically.
- **Numbers live in code.** Metrics, anomalies, and rankings are computed by a facts engine. Models only receive precomputed values and named buckets.
- **Workspaces as a searchable tree.** Beam search over workspace options returns a ranked list, not a single guess. When the model is torn between two views, MORPH shows both.
- **Fast shape, slow words.** A fast decision model (Jev) picks the layout in one round trip. An LLM then streams explanations into it. Each claim must cite computed facts, and code verifies the numbers before anything is shown.
- **Stability by default.** MORPH morphs only when confidence is high enough for the risk involved, and when the new layout clearly beats the current one. Asking the same thing twice doesn't reshuffle the screen.
- **Policy is code.** Permissions are deterministic and can't be overridden by any confidence score. Forbidden workspaces are never offered to the model in the first place.
- **You can always override.** Alternates, undo, and confirmations are built in, and every override is logged as evaluation data.

---

## How it works

```
intent + UI state + data
        │
Tier 0  Facts engine (code) ─────────── numbers, buckets, capability flags
        │
Tier 1  Decision provider (Jev / rules / replay) ── typed answers + confidence
        → beam search over workspaces → policy → stability gate
        → deterministic templates → UI state → diff → animated render
        │
Tier 2  LLM narrative → claims cite facts → verified in code → insight panels
        │
        Decision trace → Inspector
```

---

## Quickstart

Requirements: Node 22+ and pnpm (`corepack enable`).

```bash
git clone https://github.com/yahyeameer/MORPH.git
cd MORPH
pnpm install
pnpm dev          # http://localhost:3000
```

**No API keys needed.** By default, the demo replays recorded decisions and falls back to a rules provider.

To use live decisions, copy `.env.example` to `.env.local` and set:

```bash
MORPH_PROVIDER=jev
TYPESAFE_API_KEY=your_key
MORPH_JEV_MODEL=jev-1.13.0

# Optional: LLM-written insights (otherwise code-generated sentences are used)
MORPH_NARRATIVE_PROVIDER=anthropic
MORPH_NARRATIVE_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_API_KEY=your_key
```

Open the inspector with `?inspect=1` or `Ctrl + .` to see why each view was chosen.

To keep traces after the tab closes, set `MORPH_TRACE_DIR=.morph/traces`. The demo then saves every decision trace and override event as JSON Lines, one file per day, without lens contents. Read them back with the same metrics the inspector uses:

```ts
import { summarize } from "morph-core";
import { readTraceStore } from "morph-core/node";

const { traces, events } = readTraceStore(".morph/traces");
console.log(summarize(traces, events));
```

`pnpm calibrate` reads the same directory and suggests `autoThreshold` values per model version: for each risk level, the lowest threshold where the morphs at or above it were kept (not undone, not declined) at least 90% (low), 95% (medium) or 99% (high) of the time, once there are 30 outcomes. It only prints suggestions. Replay the goldens before applying them or moving to a new model version.

With `MORPH_TRACE_LENS=1` the saved traces also keep the lens output (what the provider saw, never rows). Two tools use it:

- `pnpm research` runs one autoresearch round: a classifier learns which workspace users kept from the answers they got, an LLM (the `MORPH_NARRATIVE_*` settings) proposes new closed-form questions for the turns it gets wrong, Jev answers them over the logged turns, and only questions that improve held-out accuracy are kept. It writes a report; adding a question to the app stays your call. `--dry-run` shows the LLM prompt without calling anything.
- `pnpm distill` trains a small offline classifier that mimics Jev's answers. Point `MORPH_DISTILLED_MODEL` at the file and it runs before rules as a fallback, or on its own with `MORPH_PROVIDER=distilled`, with no network.

---

## Using the runtime

```ts
import { createMorph, RulesProvider, RemoteProvider } from "morph-core";

const morph = createMorph({
  registry,      // capabilities: type, props schema (Zod), risk, permission
  templates,     // deterministic builders: leaf workspace → components
  tree,          // workspace tree the resolver searches
  specs,         // atomic decision questions (choice / score / noul)
  lenses,        // minimal state each question may see
  policy,        // permission + risk rules (pure code)
  provider: new RemoteProvider({ url: "/api/morph/decide" }),
});

const { state, outcome, trace } = await morph.resolve(context, { trigger: "intent" });
```

```tsx
import { MorphProvider, MorphIntentBar, MorphAlternates, MorphWorkspace, MorphInspector } from "morph-react";

<MorphProvider morph={morph} renderers={renderers} initialState={overview}>
  <MorphIntentBar suggestions={["Why did revenue fall?"]} />
  <MorphAlternates />
  <MorphWorkspace />
  <MorphInspector />
</MorphProvider>
```

Morph components (KPI, chart, table, insight, action, alert) install into your own codebase through a shadcn registry, so you own the UI code. `pnpm --filter @morph/demo registry:build` writes it to `apps/demo/public/r/`. Point a `@morph` registry at wherever the demo is served, then add components:

```jsonc
// components.json
{ "registries": { "@morph": "https://<your-demo-host>/r/{name}.json" } }
```

```bash
npx shadcn add @morph/morph-kpi
```

---

## Decision providers

| Provider | Runs | Use for |
|---|---|---|
| `JevProvider` | Server | Fast, calibrated structured decisions from TypeSafe's Jev model |
| `RulesProvider` | Anywhere | Offline use, tests, and last-resort fallback |
| `ReplayProvider` | Anywhere | Recorded decisions for demos and CI, with no keys |
| `CompositeProvider` | Anywhere | Fallback chains with a time budget |
| `RemoteProvider` | Browser | Calls your server route; keys never reach the client |

---

## Security model

- Model output is never authority. Every decision passes schema validation, the stability gate, deterministic policy, and prop validation before anything renders.
- There is no generated code or markup, and no `eval` or `dangerouslySetInnerHTML`. Models only choose from closed option sets.
- Dataset content is treated as untrusted, and adversarial inputs are part of the test suite.
- API keys stay on the server, and model versions are pinned and recorded in every trace.

---

## Project structure

```
packages/core     morph-core   framework-neutral runtime
packages/react    morph-react  React bindings, renderer, inspector
apps/demo         Talk-to-UI sales dashboard (Next.js)
fixtures/         recorded decisions + golden scenarios
docs/decisions/   architecture decision records
```

---

## Roadmap

- [x] M0 Scaffold and CI
- [x] M1 Static runtime: registry, templates, diff, animated renderer
- [x] M2 Decision layer: specs, planner, rules, replay, cache
- [x] M3 Jev provider and server route
- [x] M4 Beam-search resolver, stability gate, policy
- [x] M5 Talk-to-UI demo
- [x] M6 Grounded narrative insights
- [x] M7 Inspector and evaluation metrics
- [x] M8 Packages, shadcn registry, deployment config (npm publish and the Vercel deploy are pending)

- [x] CSV upload: bring your own sales CSV (in the browser, no new dependencies, ADR 0006)

- [x] Trace storage: saved traces and events as JSON Lines (ADR 0007)

- [x] Threshold calibration: `pnpm calibrate` suggests gate thresholds per model version (ADR 0008)

- [x] Autoresearch round and distilled offline classifier (ADR 0009)

**Later:**
- hosted trace storage and A/B experiments

---

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). Read [`AGENTS.md`](./AGENTS.md) and [`SPEC.md`](./SPEC.md) first. They apply to humans and AI coding agents alike. Run `pnpm verify` before opening a PR. Changes that alter behavior need tests and, where relevant, a golden scenario.

## License

MIT (see [`LICENSE`](./LICENSE)).

## Acknowledgements

MORPH's decision layer builds on the System One approach documented by [TypeSafe](https://docs.typesafe.ai/introduction): atomic typed questions, calibrated probabilities, and confidence-gated behavior. Jev is TypeSafe's model; MORPH supports it as one provider among several.
