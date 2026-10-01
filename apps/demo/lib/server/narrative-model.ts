import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { Output, streamText } from "ai";
import type { ClaimStreamer } from "./narrate";

// Narrative LLM wiring (SPEC §5a, §12). Server only. Model IDs come from env, never code.

export interface NarrativeEnv {
  [name: string]: string | undefined;
  MORPH_NARRATIVE_PROVIDER?: string | undefined;
  MORPH_NARRATIVE_MODEL?: string | undefined;
  ANTHROPIC_API_KEY?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
}

export type NarrativeConfig =
  | { provider: "none" }
  | { provider: "anthropic" | "openai"; model: string; apiKey: string };

export class NarrativeConfigError extends Error {
  override readonly name = "NarrativeConfigError";
}

export function readNarrativeConfig(env: NarrativeEnv): NarrativeConfig {
  const provider = (env.MORPH_NARRATIVE_PROVIDER || "none").trim().toLowerCase();
  if (provider === "none") return { provider: "none" };
  if (provider !== "anthropic" && provider !== "openai") {
    throw new NarrativeConfigError(
      `MORPH_NARRATIVE_PROVIDER must be none, anthropic, or openai (got "${provider}").`,
    );
  }
  const model = env.MORPH_NARRATIVE_MODEL?.trim();
  if (!model) {
    throw new NarrativeConfigError(
      `MORPH_NARRATIVE_MODEL is required when MORPH_NARRATIVE_PROVIDER=${provider}.`,
    );
  }
  const keyName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const apiKey = env[keyName]?.trim();
  if (!apiKey) {
    throw new NarrativeConfigError(
      `${keyName} is required when MORPH_NARRATIVE_PROVIDER=${provider}.`,
    );
  }
  return { provider, model, apiKey };
}

export function createClaimStreamer(config: NarrativeConfig): ClaimStreamer | null {
  if (config.provider === "none") return null;
  const model =
    config.provider === "anthropic"
      ? createAnthropic({ apiKey: config.apiKey })(config.model)
      : createOpenAI({ apiKey: config.apiKey })(config.model);
  return ({ instructions, prompt, schema, signal }) =>
    streamText({
      model,
      instructions,
      prompt,
      output: Output.object({ schema }),
      abortSignal: signal,
      maxRetries: 1,
      onError: ({ error }) => {
        console.error("[morph/narrate] model stream error:", error);
      },
    }).partialOutputStream;
}

let cached: { streamer: ClaimStreamer | null } | undefined;

/** One streamer per server process. Misconfiguration fails loudly once, then uses facts. */
export function serverClaimStreamer(): ClaimStreamer | null {
  if (!cached) {
    try {
      cached = { streamer: createClaimStreamer(readNarrativeConfig(process.env)) };
    } catch (err) {
      console.error(`[morph/narrate] ${err instanceof Error ? err.message : String(err)}`);
      cached = { streamer: null };
    }
  }
  return cached.streamer;
}
