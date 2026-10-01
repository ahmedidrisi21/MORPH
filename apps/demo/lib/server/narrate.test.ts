import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createClaimsSchema, type Fact } from "morph-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTION_IDS } from "../morph/registry";
import {
  type ClaimChecker,
  type ClaimStreamer,
  createNarrateHandler,
  type NarrateLine,
  narratePrompt,
} from "./narrate";
import {
  createClaimStreamer,
  NARRATIVE_MAX_OUTPUT_TOKENS,
  NarrativeConfigError,
  readNarrativeConfig,
} from "./narrative-model";
import { type RateLimiter, tokenBucket } from "./rate-limit";

const facts: Fact[] = [
  {
    id: "revenue.change_pct.last_3m",
    label: "Revenue change, last 3 months vs prior 3",
    value: -17.24,
    unit: "pct",
    bucket: "large_decline",
    text: "Revenue fell 17% vs the prior 3 months (large decline).",
  },
  {
    id: "segment.top_contributor",
    label: "Top contributing segment",
    value: "Enterprise",
    text: "Enterprise drove most of the drop.",
  },
];

const body = {
  slotId: "investigation.by_time:insight:why",
  intent: "Why did revenue fall?",
  facts,
};

function post(payload: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/morph/narrate", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/x-ndjson", ...headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

function handler(streamer: ClaimStreamer | null, limiter: RateLimiter = { take: () => true }) {
  return createNarrateHandler({
    streamer: () => streamer,
    actionIds: ACTION_IDS,
    limiter,
    log: () => {},
  });
}

async function lines(res: Response): Promise<NarrateLine[]> {
  expect(res.headers.get("content-type")).toContain("application/x-ndjson");
  const text = await res.text();
  return text
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as NarrateLine);
}

/** Emits growing partial objects, like the AI SDK's partialOutputStream. */
function streamOf(final: { claims: unknown[]; actionIds?: unknown[] }): ClaimStreamer {
  return async function* () {
    for (let i = 1; i <= final.claims.length; i++) {
      yield { claims: final.claims.slice(0, i) };
    }
    yield final;
  };
}

const claims = (ls: NarrateLine[]) => ls.filter((l) => l.type === "claim");
const done = (ls: NarrateLine[]) =>
  ls.find((l) => l.type === "done") as Extract<NarrateLine, { type: "done" }>;

describe("POST /api/morph/narrate", () => {
  it("falls back to the facts' own sentences with no narrative provider", async () => {
    const out = await lines(await handler(null)(post(body)));
    expect(claims(out).map((c) => c.type === "claim" && c.claim.text)).toEqual(
      facts.map((f) => f.text),
    );
    expect(claims(out).every((c) => c.type === "claim" && c.source === "facts")).toBe(true);
    expect(done(out)).toMatchObject({
      fallback: true,
      claimsIn: 0,
      claimsKept: 0,
      slotId: body.slotId,
    });
  });

  it("streams only verified claims", async () => {
    const streamer = streamOf({
      claims: [
        { text: "Revenue fell 17% in the last 3 months.", factIds: ["revenue.change_pct.last_3m"] },
        { text: "Revenue fell 25%.", factIds: ["revenue.change_pct.last_3m"] },
        { text: "Enterprise drove most of it.", factIds: ["segment.top_contributor"] },
        { text: "Payroll is up.", factIds: ["payroll.total"] },
      ],
    });
    const out = await lines(await handler(streamer)(post(body)));
    const texts = claims(out).map((c) => c.type === "claim" && c.claim.text);
    expect(texts).toEqual([
      "Revenue fell 17% in the last 3 months.",
      "Enterprise drove most of it.",
    ]);
    expect(claims(out).every((c) => c.type === "claim" && c.source === "ai")).toBe(true);
    expect(done(out)).toMatchObject({ claimsIn: 4, claimsKept: 2, fallback: false });
  });

  it("considers at most 4 claims", async () => {
    const ok = { text: "Enterprise drove most of it.", factIds: ["segment.top_contributor"] };
    const out = await lines(
      await handler(streamOf({ claims: [ok, ok, ok, ok, ok, ok] }))(post(body)),
    );
    expect(claims(out)).toHaveLength(4);
    expect(done(out).claimsIn).toBe(4);
  });

  it("drops invented numbers, altered numbers and unknown fact IDs", async () => {
    const streamer = streamOf({
      claims: [
        { text: "Revenue fell 17.2%.", factIds: ["revenue.change_pct.last_3m"] },
        { text: "Revenue fell 18%.", factIds: ["revenue.change_pct.last_3m"] },
        { text: "Revenue fell by 9 million.", factIds: ["revenue.change_pct.last_3m"] },
        { text: "Something happened.", factIds: ["nope"] },
      ],
      actionIds: ["email_customers", "wire_money"],
    });
    const out = await lines(await handler(streamer)(post(body)));
    expect(claims(out).map((c) => c.type === "claim" && c.claim.text)).toEqual([
      "Revenue fell 17.2%.",
    ]);
    const d = done(out);
    expect(d).toMatchObject({ claimsIn: 4, claimsKept: 1, fallback: false });
    expect(d.dropped).toHaveLength(3);
    expect(d.actionIds).toEqual(["email_customers"]);
  });

  it("falls back when no claim survives", async () => {
    const streamer = streamOf({
      claims: [{ text: "Up 99%.", factIds: ["segment.top_contributor"] }],
    });
    const out = await lines(await handler(streamer)(post(body)));
    expect(claims(out).every((c) => c.type === "claim" && c.source === "facts")).toBe(true);
    expect(done(out)).toMatchObject({ claimsIn: 1, claimsKept: 0, fallback: true, actionIds: [] });
  });

  it("drops malformed claims", async () => {
    const streamer = streamOf({ claims: [{ text: "", factIds: [] }, { text: 5 }] });
    const d = done(await lines(await handler(streamer)(post(body))));
    expect(d.dropped).toEqual(["malformed claim", "malformed claim"]);
    expect(d.fallback).toBe(true);
  });

  it("falls back when the model stream throws", async () => {
    const throwing: ClaimStreamer = () => ({
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.reject(new Error("upstream 500")),
      }),
    });
    const out = await lines(await handler(throwing)(post(body)));
    expect(done(out)).toMatchObject({ fallback: true, dropped: ["provider error"] });
    expect(claims(out)).toHaveLength(facts.length);
  });

  it("tells the client the HTTP status of a provider failure, never its message", async () => {
    const limited: ClaimStreamer = async function* () {
      yield* [];
      throw Object.assign(new Error("secret upstream detail: key sk-123"), { statusCode: 429 });
    };
    const res = await handler(limited)(post(body, { accept: "application/json" }));
    const json = (await res.json()) as { dropped: string[]; source: string };
    expect(json.dropped).toEqual(["provider error (429)"]);
    expect(json.source).toBe("facts");
    expect(JSON.stringify(json)).not.toContain("secret");
  });

  it("says when the model answered with nothing, apart from a failure", async () => {
    for (const streamer of [streamOf({ claims: [] }), async function* () {} as ClaimStreamer]) {
      const d = done(await lines(await handler(streamer)(post(body))));
      expect(d).toMatchObject({ claimsIn: 0, claimsKept: 0, fallback: true });
      expect(d.dropped).toEqual(["model returned no claims"]);
    }
  });

  it("keeps claims verified before a mid-stream failure", async () => {
    const partial: ClaimStreamer = async function* () {
      yield {
        claims: [
          { text: "Revenue fell 17%.", factIds: ["revenue.change_pct.last_3m"] },
          { text: "Enterprise", factIds: ["segment.top_contributor"] },
        ],
      };
      throw new Error("connection reset");
    };
    const out = await lines(await handler(partial)(post(body)));
    expect(claims(out).map((c) => c.type === "claim" && c.claim.text)).toEqual([
      "Revenue fell 17%.",
    ]);
    expect(done(out).fallback).toBe(false);
  });

  it("falls back when the streamer cannot be created", async () => {
    const h = createNarrateHandler({
      streamer: () => {
        throw new Error("misconfigured");
      },
      actionIds: ACTION_IDS,
      limiter: { take: () => true },
      log: () => {},
    });
    expect(done(await lines(await h(post(body)))).fallback).toBe(true);
  });

  it("replies with one JSON object when the client does not ask for a stream", async () => {
    const streamer = streamOf({
      claims: [
        { text: "Revenue fell 17%.", factIds: ["revenue.change_pct.last_3m"] },
        { text: "Revenue fell 30%.", factIds: ["revenue.change_pct.last_3m"] },
      ],
      actionIds: ["export_list"],
    });
    const res = await handler(streamer)(post(body, { accept: "application/json" }));
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toMatchObject({
      slotId: body.slotId,
      source: "ai",
      claims: [{ text: "Revenue fell 17%.", factIds: ["revenue.change_pct.last_3m"] }],
      claimsIn: 2,
      claimsKept: 1,
      actionIds: ["export_list"],
    });

    const none = await (await handler(null)(post(body, { accept: "*/*" }))).json();
    expect(none).toMatchObject({ source: "facts", claims: facts.map((f) => ({ text: f.text })) });
  });

  it("rejects bad bodies and rate-limits", async () => {
    const h = handler(null, tokenBucket({ capacity: 3, refillPerSec: 0 }));
    expect((await h(post("nope"))).status).toBe(400);
    expect((await h(post({ ...body, facts: [] }))).status).toBe(400);
    expect((await h(post({ ...body, intent: "x".repeat(40_000) }))).status).toBe(413);
    expect((await h(post(body))).status).toBe(429);
  });

  it("builds a prompt that carries only fact ids, labels and sentences", () => {
    const prompt = narratePrompt(body);
    expect(prompt).toContain("revenue.change_pct.last_3m");
    expect(prompt).toContain("Why did revenue fall?");
    expect(prompt).not.toContain("large_decline");
  });
});

describe("readNarrativeConfig", () => {
  it("defaults to none", () => {
    expect(readNarrativeConfig({})).toEqual({ provider: "none" });
    expect(readNarrativeConfig({ MORPH_NARRATIVE_PROVIDER: "none" })).toEqual({ provider: "none" });
  });

  it("fails clearly when the model or key is missing", () => {
    expect(() => readNarrativeConfig({ MORPH_NARRATIVE_PROVIDER: "anthropic" })).toThrow(
      /MORPH_NARRATIVE_MODEL is required/,
    );
    expect(() =>
      readNarrativeConfig({ MORPH_NARRATIVE_PROVIDER: "openai", MORPH_NARRATIVE_MODEL: "m" }),
    ).toThrow(/OPENAI_API_KEY is required/);
    expect(() => readNarrativeConfig({ MORPH_NARRATIVE_PROVIDER: "llama" })).toThrow(
      NarrativeConfigError,
    );
  });

  it("reads a complete config", () => {
    expect(
      readNarrativeConfig({
        MORPH_NARRATIVE_PROVIDER: "anthropic",
        MORPH_NARRATIVE_MODEL: "some-model",
        ANTHROPIC_API_KEY: "k",
      }),
    ).toEqual({ provider: "anthropic", model: "some-model", apiKey: "k" });
  });

  it("passes an OpenAI-compatible base URL through, for openai only", () => {
    const env = {
      MORPH_NARRATIVE_MODEL: "m",
      OPENAI_API_KEY: "k",
      ANTHROPIC_API_KEY: "k",
      OPENAI_BASE_URL: " https://openrouter.ai/api/v1 ",
    };
    expect(readNarrativeConfig({ ...env, MORPH_NARRATIVE_PROVIDER: "openai" })).toEqual({
      provider: "openai",
      model: "m",
      apiKey: "k",
      baseURL: "https://openrouter.ai/api/v1",
    });
    expect(readNarrativeConfig({ ...env, MORPH_NARRATIVE_PROVIDER: "anthropic" })).toEqual({
      provider: "anthropic",
      model: "m",
      apiKey: "k",
    });
  });
});

describe("createClaimStreamer with a mock model", () => {
  afterEach(() => vi.restoreAllMocks());
  const config = { provider: "openai", model: "m", apiKey: "k" } as const;
  const usage = {
    inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 9, text: 9, reasoning: undefined },
  };
  const run = (model: MockLanguageModelV4) => {
    const stream = createClaimStreamer(config, { model })?.({
      instructions: "i",
      prompt: "p",
      schema: createClaimsSchema(ACTION_IDS),
      signal: new AbortController().signal,
    });
    return stream as AsyncIterable<{ claims?: { text: string }[] }>;
  };

  it("streams the model's claims", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "t" },
            { type: "text-delta", id: "t", delta: '{"claims":[{"text":"Revenue fell 17%.",' },
            { type: "text-delta", id: "t", delta: '"factIds":["a"]}]}' },
            { type: "text-end", id: "t" },
            { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
          ],
        }),
      }),
    });
    let last: { claims?: { text: string }[] } = {};
    for await (const partial of run(model)) last = partial;
    expect(last.claims?.[0]?.text).toBe("Revenue fell 17%.");
  });

  it("throws when the provider reports an error, which streamText otherwise swallows", async () => {
    // A rate limit or an upstream error arrives as an error chunk. The stream then just ends, with
    // nothing in it, so without the rethrow the slot looked like "the model had nothing to say".
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [{ type: "error", error: new Error("Provider returned error") }],
        }),
      }),
    });
    const seen: unknown[] = [];
    await expect(
      (async () => {
        for await (const partial of run(model)) seen.push(partial);
      })(),
    ).rejects.toThrow("Provider returned error");
    expect(seen).toEqual([]);
    expect(log).toHaveBeenCalled();
  });

  it("throws when the request itself fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const model = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error("connection refused");
      },
    });
    await expect(
      (async () => {
        for await (const _ of run(model)) {
          // drain
        }
      })(),
    ).rejects.toThrow("connection refused");
  });

  it("is null when the narrative provider is none", () => {
    expect(createClaimStreamer({ provider: "none" })).toBeNull();
  });
});

describe("createClaimStreamer request", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("caps the reply length so OpenRouter does not reserve the whole output window", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response("{}", { status: 400 });
      }),
    );
    const streamer = createClaimStreamer({
      provider: "openai",
      model: "some/model:free",
      apiKey: "k",
      baseURL: "https://openrouter.ai/api/v1",
    });
    const stream = streamer?.({
      instructions: "i",
      prompt: "p",
      schema: createClaimsSchema(ACTION_IDS),
      signal: new AbortController().signal,
    });
    try {
      for await (const _ of stream ?? []) {
        // drain; the stubbed server answers with an error
      }
    } catch {
      // the 400 is expected
    }
    expect(bodies.length).toBeGreaterThan(0);
    const sent = bodies[0] as { max_tokens?: number; max_completion_tokens?: number };
    expect(sent.max_tokens ?? sent.max_completion_tokens).toBe(NARRATIVE_MAX_OUTPUT_TOKENS);
  });
});

describe("POST /api/morph/narrate with the support check (SPEC §12.4)", () => {
  const good = {
    text: "Revenue fell 17% in the last 3 months.",
    factIds: ["revenue.change_pct.last_3m"],
  };
  const other = { text: "Enterprise drove most of it.", factIds: ["segment.top_contributor"] };
  const withChecker = (streamer: ClaimStreamer | null, checker: ClaimChecker | null) =>
    createNarrateHandler({
      streamer: () => streamer,
      checker: () => checker,
      actionIds: ACTION_IDS,
      limiter: { take: () => true },
      log: () => {},
    });

  it("drops a claim the check does not support, with its probability", async () => {
    const checker: ClaimChecker = async (c) =>
      c.text === good.text ? { supported: true, p: 0.95 } : { supported: false, p: 0.31 };
    const out = await lines(
      await withChecker(streamOf({ claims: [good, other] }), checker)(post(body)),
    );
    expect(claims(out).map((c) => c.type === "claim" && c.claim.text)).toEqual([good.text]);
    expect(done(out)).toMatchObject({
      claimsIn: 2,
      claimsKept: 1,
      dropped: ["not supported by the facts (p=0.31)"],
    });
  });

  it("only checks claims that already passed the deterministic verifier", async () => {
    const seen: string[] = [];
    const checker: ClaimChecker = async (c) => {
      seen.push(c.text);
      return { supported: true, p: 0.9 };
    };
    const wrong = { text: "Revenue fell 25%.", factIds: ["revenue.change_pct.last_3m"] };
    await lines(await withChecker(streamOf({ claims: [good, wrong] }), checker)(post(body)));
    expect(seen).toEqual([good.text]);
  });

  it("fails closed: when the check cannot run, the slot shows the facts' own sentences", async () => {
    const checker: ClaimChecker = async () => {
      throw Object.assign(new Error("secret provider detail"), { statusCode: 503 });
    };
    const res = await withChecker(streamOf({ claims: [good, other] }), checker)(post(body));
    const text = await res.clone().text();
    expect(text).not.toContain("secret provider detail");
    const out = await lines(res);
    expect(claims(out).every((c) => c.type === "claim" && c.source === "facts")).toBe(true);
    expect(done(out)).toMatchObject({
      claimsIn: 2,
      claimsKept: 0,
      fallback: true,
      dropped: ["support check failed (503)", "support check failed (503)"],
    });
  });

  it("does not call the check when there is no narrative provider", async () => {
    let calls = 0;
    const checker: ClaimChecker = async () => {
      calls += 1;
      return { supported: true, p: 1 };
    };
    await lines(await withChecker(null, checker)(post(body)));
    expect(calls).toBe(0);
  });
});
