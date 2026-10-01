# morph-core

Framework-neutral runtime for MORPH, an adaptive UI runtime: facts, typed decisions, providers,
beam search over a workspace tree, a stability gate, policy, compose, diff, a narrative verifier and
decision traces. No React, Next or DOM APIs.

```ts
import { createMorph, RulesProvider } from "morph-core";
import { JevProvider } from "morph-core/providers/jev"; // server only
import { fsFixtureStore } from "morph-core/node"; // server only
```

See the [MORPH README](https://github.com/yahyeameer/MORPH#readme) and
[SPEC](https://github.com/yahyeameer/MORPH/blob/main/SPEC.md).
