import { describe, expect, it } from "vitest";
import type { Fact } from "../facts/types";
import { createClaimsSchema, NARRATIVE_SYSTEM_PROMPT } from "./claims";
import { fallbackClaims, verifyClaims } from "./verify";

const facts: Fact[] = [
  {
    id: "rev.change",
    label: "Revenue change",
    value: -17.24,
    unit: "pct",
    text: "Revenue fell 17% vs the prior 3 months (large decline).",
  },
  {
    id: "rev.total",
    label: "Revenue",
    value: 1234567,
    unit: "usd",
    text: "Revenue was $1,234,567 in the last 3 months.",
  },
  {
    id: "seg.top",
    label: "Top segment",
    value: "Enterprise",
    text: "Enterprise drove most of the decline.",
  },
];

describe("verifyClaims", () => {
  it("keeps claims whose numbers match referenced facts (rounded 0 or 1 dp)", () => {
    const { kept, dropped } = verifyClaims(
      [
        { text: "Revenue fell 17% over the last 3 months.", factIds: ["rev.change"] },
        { text: "That is a 17.2% drop.", factIds: ["rev.change"] },
        { text: "Enterprise drove most of it.", factIds: ["seg.top"] },
      ],
      facts,
    );
    expect(dropped).toEqual([]);
    expect(kept).toHaveLength(3);
  });
  it("drops unknown fact IDs", () => {
    const r = verifyClaims(
      [
        { text: "Revenue fell.", factIds: ["made.up"] },
        { text: "x", factIds: [] },
      ],
      facts,
    );
    expect(r.kept).toEqual([]);
    expect(r.dropped[0]?.reason).toContain("made.up");
    expect(r.dropped[1]?.reason).toContain("none cited");
  });
  it("drops altered and invented numbers", () => {
    const r = verifyClaims(
      [
        { text: "Revenue fell 18%.", factIds: ["rev.change"] },
        { text: "Revenue fell 17.24%, costing 42 customers.", factIds: ["rev.change"] },
        { text: "Enterprise fell 30%.", factIds: ["seg.top"] },
        { text: "Revenue fell 17.3%.", factIds: ["rev.change"] },
      ],
      facts,
    );
    expect(r.kept).toEqual([]);
    expect(r.dropped.map((d) => d.reason)).toEqual([
      "unsupported number(s): 18%",
      "unsupported number(s): 42",
      "unsupported number(s): 30%",
      "unsupported number(s): 17.3%",
    ]);
  });
  describe("direction", () => {
    const rose: Fact = {
      id: "ord.change",
      label: "Orders change",
      value: 8.1,
      unit: "pct",
      text: "Orders rose 8% vs the prior 3 months (growth).",
    };
    const all = [...facts, rose];
    const run = (text: string, factIds: string[]) => verifyClaims([{ text, factIds }], all);

    it("drops a claim that says the opposite of the fact it cites", () => {
      const r = run("Revenue grew 17% over the last 3 months.", ["rev.change"]);
      expect(r.kept).toEqual([]);
      expect(r.dropped[0]?.reason).toBe('says "up", the cited fact(s) say "down"');
      expect(run("Orders fell 8%.", ["ord.change"]).kept).toEqual([]);
      expect(run("Revenue is down 17%.", ["rev.change"]).kept).toHaveLength(1);
      // "Enterprise drove most of the decline" is a direction too.
      expect(run("Enterprise grew most.", ["seg.top"]).kept).toEqual([]);
    });
    it("keeps a claim that agrees, in any wording", () => {
      expect(run("Revenue dropped 17%.", ["rev.change"]).kept).toHaveLength(1);
      expect(run("Revenue declined by 17%.", ["rev.change"]).kept).toHaveLength(1);
      expect(run("Orders grew 8%.", ["ord.change"]).kept).toHaveLength(1);
      expect(run("Orders increased by 8%.", ["ord.change"]).kept).toHaveLength(1);
    });
    it("keeps a claim that mixes directions when the facts do", () => {
      const r = run("Revenue fell 17% while orders rose 8%.", ["rev.change", "ord.change"]);
      expect(r.kept).toHaveLength(1);
    });
    it("keeps a claim that cites a fact with no direction", () => {
      // rev.total says "was", not up or down; the number check alone applies.
      expect(run("Revenue grew to $1,234,567.", ["rev.total"]).kept).toHaveLength(1);
      expect(run("Enterprise stood out most.", ["seg.top"]).kept).toHaveLength(1);
    });
    it("keeps a claim with no direction word", () => {
      expect(run("That is 17% against the prior period.", ["rev.change"]).kept).toHaveLength(1);
    });
    it("still drops wrong numbers first", () => {
      expect(run("Revenue grew 40%.", ["rev.change"]).dropped[0]?.reason).toBe(
        "unsupported number(s): 40%",
      );
    });
  });
  it("accepts numbers present verbatim in the fact text", () => {
    const r = verifyClaims([{ text: "Revenue was $1,234,567.", factIds: ["rev.total"] }], facts);
    expect(r.dropped).toEqual([]);
  });
  it("builds a fallback from fact text", () => {
    expect(fallbackClaims(facts.slice(0, 1))).toEqual([
      { text: facts[0]?.text, factIds: ["rev.change"] },
    ]);
  });
});

describe("ClaimsSchema", () => {
  const schema = createClaimsSchema(["email_customers", "export_list"]);
  it("accepts valid claims and closed-enum actions", () => {
    expect(
      schema.safeParse({ claims: [{ text: "x", factIds: ["a"] }], actionIds: ["export_list"] })
        .success,
    ).toBe(true);
  });
  it("rejects unknown actions, long text, too many claims, and missing fact IDs", () => {
    expect(schema.safeParse({ claims: [], actionIds: ["delete_everything"] }).success).toBe(false);
    expect(schema.safeParse({ claims: [{ text: "x".repeat(201), factIds: ["a"] }] }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ claims: Array.from({ length: 5 }, () => ({ text: "x", factIds: ["a"] })) })
        .success,
    ).toBe(false);
    expect(schema.safeParse({ claims: [{ text: "x", factIds: [] }] }).success).toBe(false);
  });
  it("has a grounded system prompt", () => {
    expect(NARRATIVE_SYSTEM_PROMPT).toMatch(/only the facts/);
  });
});
