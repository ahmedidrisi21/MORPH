import { describe, expect, it } from "vitest";
import type { DecisionSpec } from "../../decisions/spec";
import { CompositeProvider } from "../composite";
import {
  ProviderError,
  ProviderRateLimitError,
  ProviderResponseError,
  ProviderTimeoutError,
} from "../errors";
import { RulesProvider } from "../rules";
import {
  assertPinnedModel,
  fromWire,
  JevProvider,
  mapError,
  toEntry,
  toQuestion,
  wireKeys,
} from "./index";

const specs: DecisionSpec[] = [
  {
    id: "turn_type",
    kind: "choice",
    instructions: "Using `intent`…",
    lens: "core",
    options: { new_topic: "N", unclear: "U" },
  },
  {
    id: "density",
    kind: "score",
    instructions: "How much?",
    lens: "core",
    levels: ["a", "b", "c"],
  },
  { id: "show_actions", kind: "noul", instructions: "Act?", lens: "core" },
  {
    id: "ws.root",
    kind: "noul",
    instructions: "Crit?",
    lens: "core",
    criteria: { true: "yes", false: "no" },
  },
];

/** A recorded systemOne payload, keyed by wire keys q0..q3. */
const recorded = {
  model: "jev-1.13.0",
  answers: {
    q0: {
      type: "choice",
      choice: "new_topic",
      confidence: 0.93,
      probabilities: { new_topic: 0.93, unclear: 0.07 },
    },
    q1: {
      type: "score",
      score: 1.2,
      confidence: 0.7,
      legend: { 0: "a", 1: "b", 2: "c" },
      probabilities: { 0: 0.1, 1: 0.6, 2: 0.3 },
    },
    q2: { type: "noul", noul: 0.12 },
    q3: { type: "noul", noul: 0.8 },
  },
  usage: { input_tokens: 321, output_tokens: 4 },
};

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: { url: string; body: unknown; auth: string | null }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    calls.push({ url, body: JSON.parse(String(init?.body)), auth: h.get("authorization") });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "x-typesafe-request-id": "req_1", ...headers },
    });
  };
  return { fetch, calls };
}

describe("JevProvider", () => {
  it("issues exactly one systemOne request per batch and maps answers back", async () => {
    const { fetch, calls } = mockFetch(200, recorded);
    const jev = new JevProvider({ apiKey: "test-key", fetch, maxRetries: 0 });
    const report = await jev.evaluateWithReport({ state: { intent: "Why?" }, specs });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toMatch(/\/v1\/systemone$/);
    expect(calls[0]?.auth).toBe("Bearer test-key");
    const sent = calls[0]?.body as {
      model: string;
      questions: Record<string, unknown>;
      state: unknown;
    };
    expect(sent.model).toBe("jev-1.13.0");
    expect(Object.keys(sent.questions)).toEqual(["q0", "q1", "q2", "q3"]);
    expect(sent.state).toEqual({ intent: "Why?" });

    const a = report.answers;
    expect(a.turn_type).toMatchObject({ kind: "choice", value: "new_topic", confidence: 0.93 });
    expect(a.turn_type?.meta).toMatchObject({
      provider: "jev",
      model: "jev-1.13.0",
      calibrated: true,
    });
    expect(a.density).toMatchObject({ kind: "score", expected: 1.2 });
    expect(a.density?.kind === "score" && a.density.probabilities[1]).toBeCloseTo(0.6);
    expect(a.show_actions).toMatchObject({ kind: "noul", p: 0.12 });
    expect(report.attempts[0]).toMatchObject({
      inputTokens: 321,
      requestId: "req_1",
      model: "jev-1.13.0",
    });
    expect(Object.keys(await jev.evaluate({ state: "s", specs }))).toHaveLength(4);
  });

  it("round-trips wire keys and questions", () => {
    const keyed = wireKeys(specs);
    expect(keyed.map(([k, s]) => `${k}=${s.id}`)).toEqual([
      "q0=turn_type",
      "q1=density",
      "q2=show_actions",
      "q3=ws.root",
    ]);
    expect(toQuestion(specs[0] as DecisionSpec)).toMatchObject({
      type: "choice",
      criteria: { new_topic: "N" },
    });
    expect(toQuestion(specs[1] as DecisionSpec)).toMatchObject({
      type: "score",
      criteria: ["a", "b", "c"],
    });
    expect(toQuestion(specs[2] as DecisionSpec)).toMatchObject({ type: "noul" });
    expect(toQuestion(specs[3] as DecisionSpec)).toMatchObject({
      criteria: { true: "yes", false: "no" },
    });
    expect(toEntry(3)).toBe("3");
    expect(toEntry(null)).toBeNull();
    expect(() => fromWire(specs[0] as DecisionSpec, { type: "mystery" })).toThrow(
      ProviderResponseError,
    );
    expect(fromWire(specs[2] as DecisionSpec, { type: "noul" })).toMatchObject({ kind: "noul" });
  });

  it("maps RateLimitError and falls back to rules in a composite", async () => {
    const { fetch } = mockFetch(429, { error: "slow down" }, { "retry-after-ms": "50" });
    const jev = new JevProvider({ apiKey: "k", fetch, maxRetries: 0 });
    const err = await jev.evaluate({ state: {}, specs }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderRateLimitError);
    expect(err.requestId).toBe("req_1");
    const composite = new CompositeProvider([jev, new RulesProvider({ rules: {} })]);
    const report = await composite.evaluateWithReport({ state: {}, specs });
    expect(report.attempts.map((x) => x.ok)).toEqual([false, true]);
    expect(report.answers.turn_type?.meta.provider).toBe("rules");
  });

  it("maps API and malformed responses to ProviderError", async () => {
    const server = new JevProvider({
      apiKey: "k",
      fetch: mockFetch(500, { error: "x" }).fetch,
      maxRetries: 0,
    });
    await expect(server.evaluate({ state: {}, specs })).rejects.toThrow(/API error 500/);
    const partial = new JevProvider({
      apiKey: "k",
      fetch: mockFetch(200, { ...recorded, answers: { q0: recorded.answers.q0 } }).fetch,
    });
    await expect(partial.evaluate({ state: {}, specs })).rejects.toBeInstanceOf(
      ProviderResponseError,
    );
    const offline = new JevProvider({
      apiKey: "k",
      maxRetries: 0,
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(offline.evaluate({ state: {}, specs })).rejects.toThrow(/connection error/);
  });

  it("aborts with the caller's signal", async () => {
    const jev = new JevProvider({
      apiKey: "k",
      fetch: (_url, init) =>
        new Promise((_, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("a", "AbortError")),
          ),
        ),
    });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 5);
    await expect(jev.evaluate({ state: {}, specs, signal: ac.signal })).rejects.toBeInstanceOf(
      ProviderTimeoutError,
    );
  });

  it("requires a pinned model and refuses the browser", () => {
    expect(() => assertPinnedModel(["jev", "latest"].join("-"))).toThrow(/pinned/);
    expect(assertPinnedModel("jev-1.13.0")).toBe("jev-1.13.0");
    const g = globalThis as { window?: unknown };
    g.window = {};
    try {
      expect(() => new JevProvider({ apiKey: "k" })).toThrow(/server-only/);
    } finally {
      delete g.window;
    }
  });

  it("maps unknown errors", () => {
    expect(mapError(new Error("x"))).toBeInstanceOf(ProviderError);
    expect(mapError("y").message).toBe("y");
    const pe = new ProviderError("jev", "same");
    expect(mapError(pe)).toBe(pe);
  });
});
