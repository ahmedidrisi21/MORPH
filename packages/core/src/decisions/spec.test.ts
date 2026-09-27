import { describe, expect, it } from "vitest";
import { type DecisionSpec, SpecValidationError, specKeys, validateSpecs } from "./spec";

const choice = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "turn_type",
  kind: "choice",
  instructions: "Using `intent`, which?",
  lens: "core",
  options: { a: "Option A", b: "Option B" },
  ...over,
});

const expectInvalid = (specs: unknown[], fragment: string) => {
  try {
    validateSpecs(specs);
  } catch (e) {
    expect(e).toBeInstanceOf(SpecValidationError);
    expect((e as SpecValidationError).message).toContain(fragment);
    return;
  }
  throw new Error("expected validation to fail");
};

describe("validateSpecs", () => {
  it("accepts valid specs of every kind", () => {
    const specs = validateSpecs([
      choice(),
      {
        id: "density",
        kind: "score",
        instructions: "How much?",
        lens: "core",
        levels: ["low", "high"],
      },
      { id: "show_actions", kind: "noul", instructions: "Act?", lens: "core" },
      {
        id: "x.y",
        kind: "noul",
        instructions: "Q?",
        lens: "core",
        criteria: { true: "yes", false: "no" },
        dependsOn: ["show_actions"],
      },
    ]);
    expect(specs).toHaveLength(4);
  });
  it("rejects a score with 1 level", () => {
    expectInvalid(
      [{ id: "s", kind: "score", instructions: "Q", lens: "core", levels: ["only"] }],
      "2–10 levels",
    );
  });
  it("rejects a score with 11 levels", () => {
    const levels = Array.from({ length: 11 }, (_, i) => `level ${i}`);
    expectInvalid(
      [{ id: "s", kind: "score", instructions: "Q", lens: "core", levels }],
      "2–10 levels",
    );
  });
  it("rejects an empty description", () => {
    expectInvalid([choice({ options: { a: "Option A", b: "  " } })], "non-empty");
  });
  it("rejects a single option", () => {
    expectInvalid([choice({ options: { a: "A" } })], "at least 2 options");
  });
  it("rejects non-snake_case labels", () => {
    expectInvalid([choice({ options: { "Bad-Label": "A", b: "B" } })], "snake_case");
  });
  it("rejects bad ids", () => {
    expectInvalid([choice({ id: "Turn Type" })], "id must match");
  });
  it("rejects duplicate ids", () => {
    expectInvalid([choice(), choice()], "duplicate id");
  });
  it("rejects unknown dependsOn", () => {
    expectInvalid([choice({ dependsOn: ["nope"] })], 'unknown spec "nope"');
  });
  it("rejects cycles", () => {
    expectInvalid(
      [choice({ id: "a", dependsOn: ["b"] }), choice({ id: "b", dependsOn: ["a"] })],
      "cycle",
    );
  });
  it("rejects empty instructions and unknown kinds", () => {
    expectInvalid([choice({ instructions: "" })], "non-empty");
    expectInvalid([{ id: "z", kind: "other" }], "z:");
    expectInvalid([null], "#0");
  });
});

describe("specKeys", () => {
  it("lists labels and level indices", () => {
    const [c, s, n] = validateSpecs([
      choice(),
      { id: "d", kind: "score", instructions: "Q", lens: "core", levels: ["a", "b", "c"] },
      { id: "n", kind: "noul", instructions: "Q", lens: "core" },
    ]) as DecisionSpec[];
    expect(specKeys(c as DecisionSpec)).toEqual(["a", "b"]);
    expect(specKeys(s as DecisionSpec)).toEqual(["0", "1", "2"]);
    expect(specKeys(n as DecisionSpec)).toEqual([]);
  });
});
