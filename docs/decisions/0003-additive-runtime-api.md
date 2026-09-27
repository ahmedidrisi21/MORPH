# 0003 — Additive runtime and React APIs

## Context

SPEC §6–§11 define the public API. Implementing undo (I12), fallback traces (I11) and the React bindings needed a few things the spec does not name. Changing a public API needs a human; adding optional members does not break any specified signature.

## Decision

Additions only; every name and shape in the spec is unchanged:

- `Morph`: `undo()`, `canUndo()`, `getState()`, `setState()`, `composeLeaf()`, `getTrace()`, `sink`, `registry`, `config`. `override(traceId, leafId, via?)` takes an optional `via` (default `"alternate"`).
- `createMorph` config: `lenses` and `policy` default to `{ core: coreLens }` and `defaultPolicy`; optional `traceFull`, `lensBudget`, `initialState`, `describeWorkspace`.
- Providers may implement `ReportingProvider.evaluateWithReport()` so wrapped attempts (Composite, Replay, Remote, Jev) are recorded as trace batches with `fallbackFrom`, `error`, `inputTokens` and `requestId`.
- `GateOutcome` clarify may carry `filters` (step 3: "clarify with the supported filters as options"); `MorphUIState.pending.filters` mirrors it.
- `DecisionTrace` gains optional `result`, `validation` and `error`; `MorphEvent` gains `render_error` (invalid props are traced, §13.5).
- Decide route response gains optional `attempts` next to `fallbacks`.
- `MorphProvider` takes a `context` prop (user, facts, untrusted) because the provider builds `MorphContext` for each intent.

Gate outcomes `confirm`, `alternates` and `clarify` keep the current workspace and set `pending` (I13: no automatic change unless the gate passes). The golden runner applies the first option, as §13.3 describes.

## Consequences

Existing spec-shaped code keeps compiling. README/SPEC readers see the same API; the extras are documented here and in the type definitions.
