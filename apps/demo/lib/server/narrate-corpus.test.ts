import { readFileSync } from "node:fs";
import { getFact } from "morph-core";
import { describe, expect, it } from "vitest";
import { computeSalesFacts, parseSalesCsv } from "../facts";

// The claim corpus (fixtures/narrative/claims.json) is checked against facts it carries. They must
// be the facts the demo's engine really produces, or the corpus tests something that never happens.

const corpus = JSON.parse(
  readFileSync(new URL("../../../../fixtures/narrative/claims.json", import.meta.url), "utf8"),
) as { facts: { id: string; value: unknown; text: string; unit?: string }[] };
const real = computeSalesFacts(
  parseSalesCsv(readFileSync(new URL("../../data/sales.csv", import.meta.url), "utf8")),
);

describe("claim corpus facts", () => {
  it("match the facts engine on the committed demo data", () => {
    for (const f of corpus.facts) {
      const actual = getFact(real, f.id);
      expect(actual, f.id).toBeDefined();
      expect({ value: actual?.value, text: actual?.text, unit: actual?.unit }, f.id).toEqual({
        value: f.value,
        text: f.text,
        unit: f.unit,
      });
    }
  });
});
