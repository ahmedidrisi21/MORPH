import { describe, expect, it } from "vitest";
import { bucketLabel, pctChangeBucket, shareBucket, zScoreBucket } from "./buckets";
import { type Facts, getFact, hasCapability } from "./types";

describe("pctChangeBucket", () => {
  it.each([
    [-40, "large_decline"],
    [-15, "large_decline"],
    [-14.9, "decline"],
    [-5, "decline"],
    [-4.9, "flat"],
    [0, "flat"],
    [4.9, "flat"],
    [5, "growth"],
    [14.9, "growth"],
    [15, "strong_growth"],
  ])("%d → %s", (p, bucket) => {
    expect(pctChangeBucket(p)).toBe(bucket);
  });
});

describe("other buckets", () => {
  it("z-score", () => {
    expect(zScoreBucket(2.1)).toBe("anomaly_high");
    expect(zScoreBucket(-2.1)).toBe("anomaly_low");
    expect(zScoreBucket(2)).toBe("normal");
  });
  it("share", () => {
    expect(shareBucket(5)).toBe("minor");
    expect(shareBucket(-20)).toBe("notable");
    expect(shareBucket(45)).toBe("major");
    expect(shareBucket(80)).toBe("dominant");
  });
  it("labels", () => {
    expect(bucketLabel("large_decline")).toBe("large decline");
  });
});

describe("facts helpers", () => {
  const facts: Facts = {
    datasetId: "d",
    items: [{ id: "a", label: "A", value: 1, text: "A is 1." }],
    capabilities: [{ id: "has_x", description: "X" }],
    filters: {},
  };
  it("finds facts and capabilities", () => {
    expect(getFact(facts, "a")?.value).toBe(1);
    expect(getFact(facts, "b")).toBeUndefined();
    expect(hasCapability(facts, "has_x")).toBe(true);
    expect(hasCapability(facts, "has_y")).toBe(false);
  });
});
