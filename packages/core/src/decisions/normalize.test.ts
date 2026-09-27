import { describe, expect, it } from "vitest";
import { ProviderResponseError } from "../providers/errors";
import { nearestLevel, normalizeAnswer } from "./normalize";
import type { DecisionSpec } from "./spec";

const meta = { provider: "t", model: "m", calibrated: true, latencyMs: 1, cached: false };
const choice: DecisionSpec = {
  id: "c",
  kind: "choice",
  instructions: "Q",
  lens: "core",
  options: { a: "A", b: "B" },
};
const score: DecisionSpec = {
  id: "s",
  kind: "score",
  instructions: "Q",
  lens: "core",
  levels: ["x", "y", "z"],
};
const noul: DecisionSpec = { id: "n", kind: "noul", instructions: "Q", lens: "core" };

describe("normalizeAnswer", () => {
  it("renormalizes within tolerance", () => {
    const a = normalizeAnswer(choice, { kind: "choice", probabilities: { a: 0.6, b: 0.41 } }, meta);
    if (a.kind !== "choice") throw new Error();
    expect(a.probabilities.a! + a.probabilities.b!).toBeCloseTo(1, 10);
    expect(a.value).toBe("a");
    expect(a.confidence).toBeCloseTo(0.6 / 1.01);
  });
  it("accepts the exact tolerance edge and rejects beyond it", () => {
    expect(() =>
      normalizeAnswer(choice, { kind: "choice", probabilities: { a: 0.5, b: 0.519 } }, meta),
    ).not.toThrow();
    expect(() =>
      normalizeAnswer(choice, { kind: "choice", probabilities: { a: 0.5, b: 0.53 } }, meta),
    ).toThrow(ProviderResponseError);
    expect(() =>
      normalizeAnswer(choice, { kind: "choice", probabilities: { a: 0.5, b: 0.47 } }, meta),
    ).toThrow(/sum/);
  });
  it("rejects missing and unknown keys", () => {
    expect(() =>
      normalizeAnswer(choice, { kind: "choice", probabilities: { a: 1 } }, meta),
    ).toThrow(/missing/);
    expect(() =>
      normalizeAnswer(choice, { kind: "choice", probabilities: { a: 0.5, b: 0.4, c: 0.1 } }, meta),
    ).toThrow(/unknown options/);
    expect(() =>
      normalizeAnswer(
        choice,
        { kind: "choice", value: "zz", probabilities: { a: 0.5, b: 0.5 } },
        meta,
      ),
    ).toThrow(/unknown choice/);
  });
  it("rejects out-of-range confidence and probabilities", () => {
    expect(() =>
      normalizeAnswer(
        choice,
        { kind: "choice", probabilities: { a: 0.5, b: 0.5 }, confidence: 1.2 },
        meta,
      ),
    ).toThrow(/confidence/);
    expect(() =>
      normalizeAnswer(choice, { kind: "choice", probabilities: { a: 1.5, b: -0.5 } }, meta),
    ).toThrow(/outside/);
  });
  it("rejects kind mismatches", () => {
    expect(() => normalizeAnswer(choice, { kind: "noul", p: 0.5 }, meta)).toThrow(
      /expected a choice/,
    );
  });
  it("normalizes score keys to numbers and computes expected", () => {
    const a = normalizeAnswer(
      score,
      { kind: "score", probabilities: { "0": 0.2, "1": 0.3, "2": 0.5 } },
      meta,
    );
    if (a.kind !== "score") throw new Error();
    expect(a.probabilities[2]).toBeCloseTo(0.5);
    expect(a.expected).toBeCloseTo(1.3);
    expect(a.confidence).toBeCloseTo(0.5);
    const b = normalizeAnswer(
      score,
      { kind: "score", expected: 1.7, confidence: 0.4, probabilities: { 0: 0.2, 1: 0.3, 2: 0.5 } },
      meta,
    );
    if (b.kind !== "score") throw new Error();
    expect(b.expected).toBe(1.7);
  });
  it("rejects bad score answers", () => {
    expect(() =>
      normalizeAnswer(score, { kind: "score", probabilities: { 0: 0.5, 1: 0.5, 5: 0 } }, meta),
    ).toThrow(/levels/);
    expect(() =>
      normalizeAnswer(
        score,
        { kind: "score", expected: 7, probabilities: { 0: 0.2, 1: 0.3, 2: 0.5 } },
        meta,
      ),
    ).toThrow(/out of range/);
  });
  it("validates noul p", () => {
    expect(normalizeAnswer(noul, { kind: "noul", p: 0.3 }, meta)).toMatchObject({
      kind: "noul",
      p: 0.3,
    });
    expect(() => normalizeAnswer(noul, { kind: "noul", p: 2 }, meta)).toThrow(/outside/);
    expect(() => normalizeAnswer(noul, { kind: "noul", p: Number.NaN }, meta)).toThrow();
  });
});

describe("nearestLevel", () => {
  it("rounds and clamps", () => {
    expect(nearestLevel(1.4, 3)).toBe(1);
    expect(nearestLevel(1.6, 3)).toBe(2);
    expect(nearestLevel(9, 3)).toBe(2);
    expect(nearestLevel(-1, 3)).toBe(0);
  });
});
