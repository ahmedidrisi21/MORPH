import { resolve } from "node:path";
import {
  CompositeProvider,
  type DecisionProvider,
  type FixtureRecord,
  memoryFixtureStore,
  ReplayProvider,
} from "@morph/core";
import { fsFixtureStore } from "@morph/core/node";
import { DEFAULT_JEV_MODEL, JevProvider } from "@morph/core/providers/jev";
import compiledFixtures from "../morph/fixtures.generated.json";
import { createRulesProvider } from "../morph/rules";

// Server provider selection from env (SPEC §5a, Appendix B). Server only: keys never leave it.

export type ProviderMode = "replay" | "rules" | "jev";

export interface ServerEnv {
  [name: string]: string | undefined;
  MORPH_PROVIDER?: string | undefined;
  MORPH_RECORD?: string | undefined;
  TYPESAFE_API_KEY?: string | undefined;
  MORPH_JEV_MODEL?: string | undefined;
  MORPH_FIXTURES_DIR?: string | undefined;
}

export interface ProviderSelection {
  provider: DecisionProvider;
  mode: ProviderMode;
  recording: boolean;
  /** Why the requested mode was changed, if it was. */
  note?: string;
}

/** Fixtures are recorded from Jev, so replay keys always use the Jev identity. */
export function replayIdentity(env: ServerEnv): { provider: string; model: string } {
  return { provider: "jev", model: env.MORPH_JEV_MODEL || DEFAULT_JEV_MODEL };
}

export function selectProvider(
  env: ServerEnv,
  fixtures: Record<string, FixtureRecord> = compiledFixtures as Record<string, FixtureRecord>,
  deps: { jev?: (opts: { apiKey: string; model: string }) => DecisionProvider } = {},
): ProviderSelection {
  const requested = (env.MORPH_PROVIDER || "replay").trim().toLowerCase();
  const rules = createRulesProvider();
  const key = replayIdentity(env);

  if (requested === "rules") return { provider: rules, mode: "rules", recording: false };

  if (requested === "jev" && env.TYPESAFE_API_KEY) {
    const makeJev = deps.jev ?? ((o: { apiKey: string; model: string }) => new JevProvider(o));
    const jev = makeJev({ apiKey: env.TYPESAFE_API_KEY, model: key.model });
    const recording = env.MORPH_RECORD === "1";
    const first = recording
      ? new ReplayProvider({
          mode: "record",
          inner: jev,
          key,
          store: fsFixtureStore(
            // Record mode is local-only; keep Next's file tracing out of this path.
            resolve(
              /*turbopackIgnore: true*/ process.cwd(),
              env.MORPH_FIXTURES_DIR || "../../fixtures/replay",
            ),
          ),
        })
      : jev;
    return { provider: new CompositeProvider([first, rules]), mode: "jev", recording };
  }

  const replay = new ReplayProvider({ mode: "replay", key, store: memoryFixtureStore(fixtures) });
  const selection: ProviderSelection = {
    provider: new CompositeProvider([replay, rules]),
    mode: "replay",
    recording: false,
  };
  if (requested === "jev")
    selection.note = "MORPH_PROVIDER=jev without TYPESAFE_API_KEY: using replay.";
  else if (requested !== "replay")
    selection.note = `Unknown MORPH_PROVIDER "${requested}": using replay.`;
  return selection;
}

let cached: ProviderSelection | undefined;

/** One provider per server process, built from process.env on first use. */
export function serverProvider(): ProviderSelection {
  if (!cached) {
    cached = selectProvider(process.env);
    if (cached.note) console.warn(`[morph] ${cached.note}`);
  }
  return cached;
}
