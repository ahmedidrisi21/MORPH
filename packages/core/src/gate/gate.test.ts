import { describe, expect, it } from "vitest";
import type { RiskLevel } from "../context/types";
import type { Answers, ChoiceAnswer } from "../decisions/answer";
import type { Candidate } from "../resolver/beam";
import { defaultGateConfig, type GateInput, resolveGateConfig, runGate } from "./gate";

const meta = (calibrated: boolean) => ({
  provider: "t",
  model: null,
  calibrated,
  latencyMs: 0,
  cached: false,
});
const choice = (value: string, confidence: number, calibrated = true): ChoiceAnswer => ({
  kind: "choice",
  value,
  probabilities: { [value]: confidence },
  confidence,
  meta: meta(calibrated),
});
const cand = (leafId: string, score: number, confs: number[] = [score]): Candidate => ({
  leafId,
  path: [leafId],
  score,
  edgeConfidences: confs,
});

function input(
  over: Partial<GateInput> = {},
  answers: Answers = { turn_type: choice("new_topic", 0.95) },
): GateInput {
  return {
    candidates: [cand("investigation.by_time", 0.9), cand("customers.list", 0.3)],
    answers,
    config: defaultGateConfig,
    trigger: "intent",
    now: 10_000,
    current: { workspaceId: "overview.default", lastMorphAt: null, score: 0.05 },
    supportsFilters: (id) =>
      id === "customers.list" || id === "investigation.by_customer" ? ["recoverable", "top_n"] : [],
    riskOf: (): RiskLevel => "low",
    treeCalibrated: true,
    ...over,
  };
}

describe("runGate", () => {
  it("auto when confident, separated and low risk", () => {
    const r = runGate(input());
    expect(r.outcome).toMatchObject({ kind: "auto", target: { leafId: "investigation.by_time" } });
    expect(r.reason).toContain("Auto");
  });
  it("stays with no candidates", () => {
    expect(runGate(input({ candidates: [] })).outcome.kind).toBe("stay");
  });
  it("clarifies on low turn_type confidence or unclear", () => {
    expect(runGate(input({}, { turn_type: choice("new_topic", 0.4) })).outcome.kind).toBe(
      "clarify",
    );
    const r = runGate(input({}, { turn_type: choice("unclear", 0.9) }));
    expect(r.outcome).toMatchObject({ kind: "clarify" });
    expect(r.outcome.kind === "clarify" && r.outcome.options).toHaveLength(2);
  });
  it("refines when the current template supports the filter", () => {
    const answers = {
      turn_type: choice("refine_current", 0.9),
      refine_filter: choice("recoverable", 0.9),
    };
    const r = runGate(
      input({ current: { workspaceId: "customers.list", lastMorphAt: 0, score: 0.3 } }, answers),
    );
    expect(r.outcome).toEqual({ kind: "refine", filter: "recoverable" });
    expect(r.filter).toBe("recoverable");
  });
  it("uncalibrated refine confidence is capped but can still pass the low threshold", () => {
    const answers = {
      turn_type: choice("refine_current", 0.99, false),
      refine_filter: choice("recoverable", 0.99, false),
    };
    const r = runGate(
      input({ current: { workspaceId: "customers.list", lastMorphAt: 0, score: 0.3 } }, answers),
    );
    expect(r.outcome.kind).toBe("refine");
  });
  it("restricts candidates to leaves supporting the filter, carrying it", () => {
    const answers = {
      turn_type: choice("refine_current", 0.9),
      refine_filter: choice("recoverable", 0.9),
    };
    const r = runGate(
      input(
        {
          current: { workspaceId: "investigation.by_time", lastMorphAt: 0, score: 0.1 },
          candidates: [
            cand("investigation.by_time", 0.9),
            cand("investigation.by_customer", 0.8),
            cand("customers.list", 0.2),
          ],
        },
        answers,
      ),
    );
    expect(r.outcome).toMatchObject({
      kind: "auto",
      target: { leafId: "investigation.by_customer" },
    });
    expect(r.filter).toBe("recoverable");
    expect(r.candidates.map((c) => c.leafId)).toEqual([
      "investigation.by_customer",
      "customers.list",
    ]);
  });
  it("clarifies when no workspace supports the filter", () => {
    const answers = {
      turn_type: choice("refine_current", 0.9),
      refine_filter: choice("declining", 0.9),
    };
    const r = runGate(
      input(
        { current: { workspaceId: "investigation.by_time", lastMorphAt: 0, score: 0.1 } },
        answers,
      ),
    );
    expect(r.outcome).toEqual({ kind: "clarify", options: [] });
  });
  it("clarifies with the supported filters when the filter is unclear", () => {
    const answers = {
      turn_type: choice("refine_current", 0.9),
      refine_filter: choice("none", 0.9),
    };
    const r = runGate(
      input({ current: { workspaceId: "customers.list", lastMorphAt: 0, score: 0.3 } }, answers),
    );
    expect(r.outcome).toMatchObject({ kind: "clarify", filters: ["recoverable", "top_n"] });
    const r2 = runGate(
      input(
        { current: { workspaceId: "investigation.by_time", lastMorphAt: 0, score: 0.3 } },
        answers,
      ),
    );
    expect(r2.outcome.kind === "clarify" && r2.outcome.filters).toBeUndefined();
  });
  it("stays when the top candidate is already shown", () => {
    const r = runGate(
      input({ current: { workspaceId: "investigation.by_time", lastMorphAt: 0, score: 0.9 } }),
    );
    expect(r.outcome).toEqual({ kind: "stay", reason: "already showing" });
  });
  it("offers alternates when separation is low", () => {
    const r = runGate(input({ candidates: [cand("a", 0.6), cand("b", 0.55)] }));
    expect(r.outcome.kind).toBe("alternates");
  });
  it("applies hysteresis", () => {
    const r = runGate(input({ current: { workspaceId: "x", lastMorphAt: 0, score: 0.85 } }));
    expect(r.outcome).toMatchObject({
      kind: "stay",
      reason: "not clearly better than the current workspace",
    });
  });
  it("applies cooldown to non-intent triggers only", () => {
    const current = { workspaceId: "overview.default", lastMorphAt: 9_500, score: 0 };
    expect(runGate(input({ current, trigger: "data" })).outcome).toMatchObject({
      kind: "stay",
      reason: "cooldown",
    });
    expect(runGate(input({ current, trigger: "intent" })).outcome.kind).toBe("auto");
  });
  it("confirms or clarifies by risk and path confidence", () => {
    expect(runGate(input({ riskOf: () => "medium" })).outcome.kind).toBe("auto");
    expect(runGate(input({ riskOf: () => "high" })).outcome.kind).toBe("confirm");
    expect(runGate(input({ riskOf: () => "critical" })).outcome.kind).toBe("clarify");
    const lowConf = [cand("investigation.by_time", 0.9, [0.9, 0.5]), cand("x", 0.1)];
    expect(runGate(input({ candidates: lowConf })).outcome.kind).toBe("clarify");
  });
  it("never auto-morphs an uncalibrated provider onto a medium-risk leaf", () => {
    for (const conf of [0.8, 0.9, 0.99, 1]) {
      const r = runGate(
        input({
          riskOf: () => "medium",
          treeCalibrated: false,
          candidates: [cand("a", conf, [conf, conf]), cand("b", 0.01)],
        }),
      );
      expect(r.outcome.kind).not.toBe("auto");
    }
  });
  it("merges partial config", () => {
    const c = resolveGateConfig({ floor: 0.6, autoThreshold: { low: 0.7 } as never });
    expect(c.floor).toBe(0.6);
    expect(c.autoThreshold).toMatchObject({ low: 0.7, medium: 0.85 });
    expect(resolveGateConfig()).toEqual(defaultGateConfig);
  });
});
