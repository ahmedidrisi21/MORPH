import { describe, expect, it } from "vitest";
import { LruCache } from "../cache/lru";
import type { Lens } from "../context/lens";
import { coreLens, LensBudgetError } from "../context/lens";
import type { MorphContext } from "../context/types";
import { RulesProvider } from "../providers/rules";
import type { DecisionBatch, DecisionProvider } from "../providers/types";
import type { Answers } from "./answer";
import { execute, plan } from "./planner";
import type { DecisionSpec } from "./spec";

const ctx: MorphContext = {
  intent: { raw: "Why did revenue fall?", history: [] },
  user: { role: "sales_manager", permissions: [] },
  ui: { workspaceId: null, componentIds: [], lastMorphAt: null, activeFilter: null },
  facts: { datasetId: "d", items: [], capabilities: [], filters: {} },
  now: 0,
};
const deps = { describeWorkspace: (id: string) => id };
const noul = (id: string, lens = "core", dependsOn?: string[]): DecisionSpec => ({
  id,
  kind: "noul",
  instructions: "Q?",
  lens,
  ...(dependsOn ? { dependsOn } : {}),
});

class CountingProvider implements DecisionProvider {
  readonly name = "counting";
  readonly calibrated = false;
  calls: DecisionBatch[] = [];
  readonly #inner = new RulesProvider({ rules: {} });
  async evaluate(batch: DecisionBatch): Promise<Answers> {
    this.calls.push(batch);
    return this.#inner.evaluate(batch);
  }
}

describe("plan", () => {
  it("groups specs sharing a lens state into exactly one batch", () => {
    const p = plan([noul("a"), noul("b"), noul("c")], ctx, { lenses: { core: coreLens }, deps });
    expect(p.stages).toHaveLength(1);
    expect(p.stages[0]?.batches).toHaveLength(1);
    expect(p.stages[0]?.batches[0]?.specs.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(p.lensStates.core?.tokensEst).toBeGreaterThan(0);
  });
  it("splits batches by distinct lens state and stages by dependsOn", () => {
    const other: Lens = () => ({ other: true });
    const same: Lens = (c, d) => coreLens(c, d);
    const p = plan(
      [noul("a"), noul("b", "other"), noul("c", "same"), noul("d", "core", ["a"])],
      ctx,
      {
        lenses: { core: coreLens, other, same },
        deps,
      },
    );
    expect(p.stages).toHaveLength(2);
    expect(p.stages[0]?.batches.map((b) => b.specs.map((s) => s.id))).toEqual([["a", "c"], ["b"]]);
    expect(p.stages[1]?.batches[0]?.specs.map((s) => s.id)).toEqual(["d"]);
  });
  it("throws LensBudgetError in dev and warns in prod", () => {
    const big: Lens = () => "x".repeat(10_000);
    expect(() => plan([noul("a", "big")], ctx, { lenses: { big }, deps })).toThrow(LensBudgetError);
    const warnings: string[] = [];
    plan([noul("a", "big")], ctx, {
      lenses: { big },
      deps,
      onBudgetExceeded: "warn",
      warn: (m) => warnings.push(m),
    });
    expect(warnings).toHaveLength(1);
  });
  it("throws on unknown lenses", () => {
    expect(() => plan([noul("a", "nope")], ctx, { lenses: {}, deps })).toThrow(/Unknown lens/);
  });
});

describe("execute", () => {
  it("sends one batch per lens state and caches answers", async () => {
    const provider = new CountingProvider();
    const cache = new LruCache();
    const p = plan([noul("a"), noul("b")], ctx, { lenses: { core: coreLens }, deps });
    const first = await execute(p.stages, provider, { cache });
    expect(provider.calls).toHaveLength(1);
    expect(first.providerCalls).toBe(1);
    expect(Object.keys(first.answers)).toEqual(["a", "b"]);
    const second = await execute(p.stages, provider, { cache });
    expect(provider.calls).toHaveLength(1);
    expect(second.providerCalls).toBe(0);
    expect(second.answers.a?.meta.cached).toBe(true);
    expect(second.batchLog[0]?.cached).toEqual(["a", "b"]);
  });
  it("only sends uncached specs", async () => {
    const provider = new CountingProvider();
    const cache = new LruCache();
    await execute(plan([noul("a")], ctx, { lenses: { core: coreLens }, deps }).stages, provider, {
      cache,
    });
    await execute(
      plan([noul("a"), noul("b")], ctx, { lenses: { core: coreLens }, deps }).stages,
      provider,
      { cache },
    );
    expect(provider.calls[1]?.specs.map((s) => s.id)).toEqual(["b"]);
  });
  it("does not cache answers that came after a fallback", async () => {
    const rules = new RulesProvider({ rules: {} });
    let calls = 0;
    // Reports one failed attempt (the primary) before the one that answered.
    const flaky: DecisionProvider & {
      evaluateWithReport(b: DecisionBatch): Promise<{
        answers: Answers;
        attempts: {
          provider: string;
          model: null;
          latencyMs: number;
          ok: boolean;
          error?: string;
        }[];
      }>;
    } = {
      name: "chain",
      calibrated: true,
      evaluate: async (b) => rules.evaluate(b),
      evaluateWithReport: async (b) => {
        calls++;
        return {
          answers: await rules.evaluate(b),
          attempts: [
            { provider: "jev", model: null, latencyMs: 1, ok: false, error: "down" },
            { provider: "rules", model: null, latencyMs: 0, ok: true },
          ],
        };
      },
    };
    const cache = new LruCache();
    const stages = plan([noul("a")], ctx, { lenses: { core: coreLens }, deps }).stages;
    await execute(stages, flaky, { cache });
    await execute(stages, flaky, { cache });
    // The second run asked the provider again instead of replaying the fallback answer.
    expect(calls).toBe(2);
  });
  it("records failures and rethrows", async () => {
    const failing: DecisionProvider = {
      name: "boom",
      calibrated: true,
      evaluate: async () => {
        throw new Error("down");
      },
    };
    const p = plan([noul("a")], ctx, { lenses: { core: coreLens }, deps });
    await expect(execute(p.stages, failing)).rejects.toThrow("down");
  });
  it("rejects providers that omit answers", async () => {
    const partial: DecisionProvider = {
      name: "partial",
      calibrated: true,
      evaluate: async () => ({}),
    };
    const p = plan([noul("a")], ctx, { lenses: { core: coreLens }, deps });
    await expect(execute(p.stages, partial)).rejects.toThrow(/no answer/);
  });
  it("respects the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const lenses: Record<string, Lens> = {};
    const specs: DecisionSpec[] = [];
    for (let i = 0; i < 8; i++) {
      lenses[`l${i}`] = () => ({ i });
      specs.push(noul(`s${i}`, `l${i}`));
    }
    const slow: DecisionProvider = {
      name: "slow",
      calibrated: false,
      evaluate: async (b) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return new RulesProvider({ rules: {} }).evaluate(b);
      },
    };
    const res = await execute(plan(specs, ctx, { lenses, deps }).stages, slow);
    expect(Object.keys(res.answers)).toHaveLength(8);
    expect(peak).toBeLessThanOrEqual(4);
    expect(res.providerCalls).toBe(8);
  });
});
