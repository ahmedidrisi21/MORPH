import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CompositeProvider,
  type DecisionProvider,
  type DistilledModel,
  DistilledProvider,
  type FixtureRecord,
  memoryFixtureStore,
  ReplayProvider,
} from "@morph/core";
import { fsFixtureStore } from "@morph/core/node";
import { DEFAULT_JEV_MODEL, JevProvider } from "@morph/core/providers/jev";
import compiledFixtures from "../morph/fixtures.generated.json";
import { createRulesProvider } from "../morph/rules";

// Server provider selection from env (SPEC §5a, Appendix B). Server only: keys never leave it.

export type ProviderMode = "replay" | "rules" | "jev" | "distilled";

export interface ServerEnv {
  [name: string]: string | undefined;
  MORPH_PROVIDER?: string | undefined;
  MORPH_RECORD?: string | undefined;
  TYPESAFE_API_KEY?: string | undefined;
  MORPH_JEV_MODEL?: string | undefined;
  MORPH_FIXTURES_DIR?: string | undefined;
  MORPH_DISTILLED_MODEL?: string | undefined;
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
  deps: {
    jev?: (opts: { apiKey: string; model: string }) => DecisionProvider;
    /** Trained offline classifier (MORPH_DISTILLED_MODEL); tried before rules. */
    distilled?: DistilledModel | null;
  } = {},
): ProviderSelection {
  const requested = (env.MORPH_PROVIDER || "replay").trim().toLowerCase();
  const rules = createRulesProvider();
  const key = replayIdentity(env);
  const distilled = deps.distilled ? new DistilledProvider(deps.distilled) : null;
  // Fallback tail: the distilled classifier when there is one, then rules (I11).
  const tail = distilled ? [distilled, rules] : [rules];

  if (requested === "rules") return { provider: rules, mode: "rules", recording: false };

  if (requested === "distilled") {
    if (distilled)
      return { provider: new CompositeProvider(tail), mode: "distilled", recording: false };
  }

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
    return { provider: new CompositeProvider([first, ...tail]), mode: "jev", recording };
  }

  const replay = new ReplayProvider({ mode: "replay", key, store: memoryFixtureStore(fixtures) });
  const selection: ProviderSelection = {
    provider: new CompositeProvider([replay, ...tail]),
    mode: "replay",
    recording: false,
  };
  if (requested === "jev")
    selection.note = "MORPH_PROVIDER=jev without TYPESAFE_API_KEY: using replay.";
  else if (requested === "distilled")
    selection.note = "MORPH_PROVIDER=distilled without MORPH_DISTILLED_MODEL: using replay.";
  else if (requested !== "replay")
    selection.note = `Unknown MORPH_PROVIDER "${requested}": using replay.`;
  return selection;
}

let cached: ProviderSelection | undefined;

/** One provider per server process, built from process.env on first use. */
export function serverProvider(): ProviderSelection {
  if (!cached) {
    cached = selectProvider(process.env, undefined, { distilled: loadDistilled(process.env) });
    if (cached.note) console.warn(`[morph] ${cached.note}`);
  }
  return cached;
}

/** Reads MORPH_DISTILLED_MODEL (a JSON file from `pnpm distill`), or null when unset. */
export function loadDistilled(env: ServerEnv): DistilledModel | null {
  const path = env.MORPH_DISTILLED_MODEL?.trim();
  if (!path) return null;
  try {
    return JSON.parse(
      readFileSync(resolve(/*turbopackIgnore: true*/ process.cwd(), path), "utf8"),
    ) as DistilledModel;
  } catch (err) {
    console.warn(
      `[morph] Could not load MORPH_DISTILLED_MODEL: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}
