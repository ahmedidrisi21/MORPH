import { describe, expect, it } from "vitest";
import type { ComponentInstance, MorphUIState } from "../compose/types";
import { diff } from "./diff";

const c = (
  id: string,
  props: unknown = { v: 1 },
  slot: ComponentInstance["slot"] = "main",
): ComponentInstance => ({
  id,
  type: "kpi",
  props,
  slot,
  priority: 0,
});
const s = (components: ComponentInstance[]): MorphUIState => ({
  version: 1,
  workspaceId: "w",
  title: "W",
  layout: "overview",
  density: 1,
  filter: null,
  components,
  alternates: [],
  pending: null,
  traceId: "t",
});

describe("diff", () => {
  it("adds everything from null", () => {
    expect(diff(null, s([c("a"), c("b")]))).toEqual([
      { op: "add", id: "a", index: 0 },
      { op: "add", id: "b", index: 1 },
    ]);
  });
  it("detects add and remove", () => {
    expect(diff(s([c("a"), c("b")]), s([c("a"), c("c")]))).toEqual([
      { op: "remove", id: "b" },
      { op: "add", id: "c", index: 1 },
    ]);
  });
  it("detects moves", () => {
    const ops = diff(s([c("a"), c("b"), c("c")]), s([c("c"), c("a"), c("b")]));
    expect(ops).toContainEqual({ op: "move", id: "c", from: 2, to: 0 });
    expect(ops.filter((o) => o.op === "move").length).toBeGreaterThan(0);
  });
  it("does not treat a shift from a removal as a move", () => {
    expect(diff(s([c("x"), c("a"), c("b")]), s([c("a"), c("b")]))).toEqual([
      { op: "remove", id: "x" },
    ]);
  });
  it("detects updates with changed prop names", () => {
    expect(diff(s([c("a", { v: 1, w: 2 })]), s([c("a", { v: 2, w: 2, z: 1 })]))).toEqual([
      { op: "update", id: "a", changedProps: ["v", "z"] },
    ]);
    expect(diff(s([c("a", [1])]), s([c("a", [2])]))).toEqual([
      { op: "update", id: "a", changedProps: ["props"] },
    ]);
    expect(diff(s([c("a", {}, "main")]), s([c("a", {}, "side")]))).toEqual([
      { op: "update", id: "a", changedProps: ["$slot"] },
    ]);
    const withSlot = { ...c("a"), narrativeSlot: { slotId: "s", factIds: ["f"] } };
    expect(diff(s([c("a")]), s([withSlot]))).toEqual([
      { op: "update", id: "a", changedProps: ["$narrativeSlot"] },
    ]);
  });
  it("identical states produce an empty diff", () => {
    const state = s([c("a", { v: { deep: [1, 2] } }), c("b")]);
    expect(diff(state, structuredClone(state))).toEqual([]);
  });
});
