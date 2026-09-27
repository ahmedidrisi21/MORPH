import { describe, expect, it } from "vitest";
import type { Answers } from "../decisions/answer";
import type { DecisionSpec } from "../decisions/spec";
import { CompositeProvider } from "./composite";
import {
  errorMessage,
  ProviderError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  ReplayMissError,
} from "./errors";
import { type FetchLike, RemoteProvider } from "./remote";
import { memoryFixtureStore, ReplayProvider, replayKey } from "./replay";
import { keywordRule, RulesProvider, stateText } from "./rules";
import { type DecisionBatch, type DecisionProvider, evaluateReported } from "./types";

const choice: DecisionSpec = {
  id: "turn_type",
  kind: "choice",
  instructions: "Q",
  lens: "core",
  options: { new_topic: "N", refine_current: "R", unclear: "U" },
};
const score: DecisionSpec = {
  id: "density",
  kind: "score",
  instructions: "Q",
  lens: "core",
  levels: ["a", "b", "c"],
};
const noul: DecisionSpec = { id: "show_actions", kind: "noul", instructions: "Q", lens: "core" };
const state = { intent: "Only show the top customers" };

const rules = new RulesProvider({
  rules: {
    turn_type: keywordRule(
      [
        { label: "refine_current", pattern: /\bonly\b/i, weight: 4 },
        { label: "new_topic", pattern: /\bwhy\b/i },
      ],
      { otherwise: "unclear" },
    ),
    density: () => ({ "2": 1 }),
    show_actions: () => 0.9,
  },
});

describe("RulesProvider", () => {
  it("produces normalized, smoothed distributions", async () => {
    const a = await rules.evaluate({ state, specs: [choice, score, noul] });
    const t = a.turn_type;
    if (t?.kind !== "choice") throw new Error();
    expect(t.value).toBe("refine_current");
    expect(t.confidence).toBeGreaterThan(0.9);
    expect(t.meta.calibrated).toBe(false);
    expect(Object.values(t.probabilities).reduce((x, y) => x + y)).toBeCloseTo(1);
    const d = a.density;
    if (d?.kind !== "score") throw new Error();
    expect(d.expected).toBeGreaterThan(1.8);
    expect(a.show_actions).toMatchObject({ kind: "noul", p: 0.9 });
  });
  it("falls back to `otherwise` and to uniform without a rule", async () => {
    const a = await rules.evaluate({ state: { intent: "hello" }, specs: [choice] });
    expect(a.turn_type?.kind === "choice" && a.turn_type.value).toBe("unclear");
    const bare = new RulesProvider({ rules: {} });
    const b = await bare.evaluate({ state: {}, specs: [choice, noul] });
    const t = b.turn_type;
    if (t?.kind !== "choice") throw new Error();
    expect(t.probabilities.new_topic).toBeCloseTo(1 / 3);
    expect(b.show_actions).toMatchObject({ p: 0.5 });
    expect(bare.has("turn_type")).toBe(false);
    expect(rules.has("turn_type")).toBe(true);
  });
  it("clamps noul results", async () => {
    const r = new RulesProvider({ rules: { show_actions: () => 3, other: () => Number.NaN } });
    const a = await r.evaluate({ state: {}, specs: [noul, { ...noul, id: "other" }] });
    expect(a.show_actions).toMatchObject({ p: 1 });
    expect(a.other).toMatchObject({ p: 0.5 });
  });
  it("reads fields from state", () => {
    expect(stateText({ intent: "x" }, "intent")).toBe("x");
    expect(stateText({ list: ["a", 1, "b"] }, "list")).toBe("a \n b");
    expect(stateText("text", "intent")).toBe("");
    expect(stateText({ n: 3 }, "n")).toBe("");
  });
});

describe("ReplayProvider", () => {
  const key = { provider: "jev", model: "jev-1.13.0" };
  it("misses in replay mode", async () => {
    const replay = new ReplayProvider({ store: memoryFixtureStore(), mode: "replay", key });
    await expect(replay.evaluate({ state, specs: [choice] })).rejects.toBeInstanceOf(
      ReplayMissError,
    );
  });
  it("records, then replays without calling the inner provider", async () => {
    const store = memoryFixtureStore();
    let calls = 0;
    const inner: DecisionProvider = {
      name: "jev",
      calibrated: true,
      evaluate: async (b) => {
        calls++;
        return rules.evaluate(b);
      },
    };
    const recorder = new ReplayProvider({ store, mode: "record", inner, key });
    await recorder.evaluate({ state, specs: [choice, noul] });
    expect(calls).toBe(1);
    expect(Object.keys(store.entries())).toHaveLength(2);
    const k = replayKey("jev", "jev-1.13.0", choice, state);
    expect(store.entries()[k]?.specId).toBe("turn_type");

    const replay = new ReplayProvider({ store, mode: "replay", key });
    const report = await replay.evaluateWithReport({ state, specs: [choice, noul] });
    expect(calls).toBe(1);
    expect(report.answers.turn_type?.meta.provider).toBe("replay(jev)");
    expect(report.attempts[0]?.ok).toBe(true);
    expect(replay.calibrated).toBe(true);
  });
  it("replay-or-record only calls inner for missing specs", async () => {
    const store = memoryFixtureStore();
    const seen: string[][] = [];
    const inner: DecisionProvider = {
      name: "jev",
      calibrated: true,
      evaluate: async (b) => {
        seen.push(b.specs.map((s) => s.id));
        return rules.evaluate(b);
      },
    };
    const p = new ReplayProvider({ store, mode: "replay-or-record", inner, key });
    await p.evaluate({ state, specs: [choice] });
    await p.evaluate({ state, specs: [choice, noul] });
    expect(seen).toEqual([["turn_type"], ["show_actions"]]);
  });
  it("needs an inner provider to record", () => {
    expect(() => new ReplayProvider({ store: memoryFixtureStore(), mode: "record", key })).toThrow(
      /inner/,
    );
  });
  it("keys depend on provider, model, spec and state", () => {
    const a = replayKey("jev", "m1", choice, state);
    expect(replayKey("jev", "m2", choice, state)).not.toBe(a);
    expect(replayKey("jev", "m1", choice, { intent: "other" })).not.toBe(a);
    expect(replayKey("jev", "m1", { ...choice, instructions: "Z" }, state)).not.toBe(a);
  });
});

const throwing: DecisionProvider = {
  name: "jev",
  calibrated: true,
  evaluate: async () => {
    throw new ProviderError("jev", "boom");
  },
};
const hanging: DecisionProvider = {
  name: "jev",
  calibrated: true,
  evaluate: (b: DecisionBatch) =>
    new Promise<Answers>((_, reject) => {
      b.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }),
};

describe("CompositeProvider", () => {
  it("falls back on throw and records it", async () => {
    const c = new CompositeProvider([throwing, rules]);
    const report = await c.evaluateWithReport({ state, specs: [choice] });
    expect(report.answers.turn_type?.meta.provider).toBe("rules");
    expect(report.attempts.map((a) => [a.provider, a.ok])).toEqual([
      ["jev", false],
      ["rules", true],
    ]);
    expect(report.attempts[0]?.error).toContain("boom");
    expect(c.name).toBe("composite(jev→rules)");
    expect(c.calibrated).toBe(true);
  });
  it("falls back on timeout within the total budget", async () => {
    const c = new CompositeProvider([hanging, rules], { budgetMs: 30 });
    const start = Date.now();
    const report = await c.evaluateWithReport({ state, specs: [choice] });
    expect(Date.now() - start).toBeLessThan(1000);
    expect(report.attempts[0]?.error).toContain("timed out");
    expect(report.answers.turn_type?.meta.provider).toBe("rules");
    expect(await c.evaluate({ state, specs: [choice] })).toHaveProperty("turn_type");
  });
  it("skips providers once the budget is gone, but always tries the last", async () => {
    let now = 0;
    const slowFail: DecisionProvider = {
      name: "slow",
      calibrated: true,
      evaluate: async () => {
        now += 100;
        throw new Error("late");
      },
    };
    const c = new CompositeProvider([slowFail, throwing, rules], {
      budgetMs: 50,
      clock: () => now,
    });
    const report = await c.evaluateWithReport({ state, specs: [choice] });
    expect(report.attempts.map((a) => a.error ?? "ok")).toEqual([
      "Error: late",
      "skipped: budget exhausted",
      "ok",
    ]);
  });
  it("throws a ProviderError with attempts when every provider fails", async () => {
    const c = new CompositeProvider([throwing, throwing]);
    const err = await c.evaluate({ state, specs: [choice] }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.attempts).toHaveLength(2);
  });
  it("stops when the caller aborts", async () => {
    const ac = new AbortController();
    const aborting: DecisionProvider = {
      name: "a",
      calibrated: true,
      evaluate: async () => {
        ac.abort();
        throw new Error("aborted");
      },
    };
    const c = new CompositeProvider([aborting, rules]);
    await expect(c.evaluate({ state, specs: [choice], signal: ac.signal })).rejects.toBeInstanceOf(
      ProviderError,
    );
  });
  it("needs at least one provider", () => {
    expect(() => new CompositeProvider([])).toThrow();
  });
});

describe("evaluateReported", () => {
  it("wraps plain providers in a single attempt", async () => {
    const r = await evaluateReported(rules, { state, specs: [noul] });
    expect(r.attempts).toEqual([
      expect.objectContaining({ provider: "rules", ok: true, model: null }),
    ]);
  });
});

describe("RemoteProvider", () => {
  const answers = { turn_type: { kind: "noul", p: 0.5, meta: {} } };
  const fetchWith =
    (status: number, body: unknown, capture?: { url?: string; body?: string }): FetchLike =>
    async (url, init) => {
      if (capture) {
        capture.url = url;
        capture.body = init.body;
      }
      return { ok: status < 400, status, json: async () => body };
    };
  it("posts batches without signals and returns answers", async () => {
    const cap: { url?: string; body?: string } = {};
    const p = new RemoteProvider({
      url: "/api/morph/decide",
      fetchImpl: fetchWith(
        200,
        { answers: [answers], provider: "rules", model: null, fallbacks: [] },
        cap,
      ),
    });
    const report = await p.evaluateWithReport({
      state,
      specs: [noul],
      signal: new AbortController().signal,
    });
    expect(cap.url).toBe("/api/morph/decide");
    expect(JSON.parse(cap.body as string)).toEqual({ batches: [{ state, specs: [noul] }] });
    expect(report.answers).toEqual(answers);
    expect(report.attempts[0]?.provider).toBe("rules");
  });
  it("calls the global fetch with the global object as this (browsers require it)", async () => {
    const original = globalThis.fetch;
    let self: unknown;
    globalThis.fetch = function (this: unknown) {
      self = this;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ answers: [answers], provider: "rules", model: null, fallbacks: [] }),
      });
    } as unknown as typeof fetch;
    try {
      await new RemoteProvider({ url: "/api/morph/decide" }).evaluate({ state, specs: [noul] });
      expect(self).toBe(globalThis);
    } finally {
      globalThis.fetch = original;
    }
  });
  it("passes through server attempts", async () => {
    const attempts = [{ provider: "jev", model: null, latencyMs: 5, ok: false, error: "x" }];
    const p = new RemoteProvider({
      url: "/d",
      fetchImpl: fetchWith(200, {
        answers: [answers],
        provider: "rules",
        model: null,
        fallbacks: ["jev"],
        attempts,
      }),
    });
    expect((await p.evaluateWithReport({ state, specs: [noul] })).attempts).toEqual(attempts);
    expect(await p.evaluate({ state, specs: [noul] })).toEqual(answers);
  });
  it("maps errors", async () => {
    const limited = new RemoteProvider({
      url: "/d",
      fetchImpl: fetchWith(429, { error: { code: "rate_limited", message: "slow down" } }),
    });
    await expect(limited.evaluate({ state, specs: [noul] })).rejects.toBeInstanceOf(
      ProviderRateLimitError,
    );
    const broken = new RemoteProvider({ url: "/d", fetchImpl: fetchWith(500, null) });
    await expect(broken.evaluate({ state, specs: [noul] })).rejects.toThrow(/500/);
    const empty = new RemoteProvider({ url: "/d", fetchImpl: fetchWith(200, { answers: [] }) });
    await expect(empty.evaluate({ state, specs: [noul] })).rejects.toThrow(/no answers/);
    const offline = new RemoteProvider({
      url: "/d",
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    await expect(offline.evaluate({ state, specs: [noul] })).rejects.toThrow(/network/);
    const badJson = new RemoteProvider({
      url: "/d",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => Promise.reject(new Error("x")),
      }),
    });
    await expect(badJson.evaluate({ state, specs: [noul] })).rejects.toThrow(/200/);
  });
});

describe("errors", () => {
  it("formats messages and carries metadata", () => {
    expect(errorMessage(new ProviderTimeoutError("jev", "slow"))).toBe(
      "ProviderTimeoutError: slow",
    );
    expect(errorMessage("plain")).toBe("plain");
    const e = new ProviderRateLimitError("jev", "x", {
      retryAfterMs: 10,
      requestId: "r1",
      cause: 1,
    });
    expect(e.retryAfterMs).toBe(10);
    expect(e.requestId).toBe("r1");
    expect(new ReplayMissError(["k"]).keys).toEqual(["k"]);
  });
});
