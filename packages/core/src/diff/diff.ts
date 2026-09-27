import { canonicalJSON } from "../cache/canonical";
import type { ComponentInstance, MorphUIState } from "../compose/types";

export type UIDiffOp =
  | { op: "add"; id: string; index: number }
  | { op: "remove"; id: string }
  | { op: "move"; id: string; from: number; to: number }
  | { op: "update"; id: string; changedProps: string[] };

function changedProps(a: ComponentInstance, b: ComponentInstance): string[] {
  const out: string[] = [];
  const pa = (a.props ?? {}) as Record<string, unknown>;
  const pb = (b.props ?? {}) as Record<string, unknown>;
  const isObj = (x: unknown) => x !== null && typeof x === "object" && !Array.isArray(x);
  if (isObj(pa) && isObj(pb)) {
    const keys = [...new Set([...Object.keys(pa), ...Object.keys(pb)])].sort();
    for (const k of keys) if (canonicalJSON(pa[k]) !== canonicalJSON(pb[k])) out.push(k);
  } else if (canonicalJSON(pa) !== canonicalJSON(pb)) {
    out.push("props");
  }
  if (a.slot !== b.slot) out.push("$slot");
  if (canonicalJSON(a.narrativeSlot) !== canonicalJSON(b.narrativeSlot)) out.push("$narrativeSlot");
  return out;
}

/** Component-level diff by stable ID. Identical states produce an empty diff. */
export function diff(prev: MorphUIState | null, next: MorphUIState): UIDiffOp[] {
  const before = prev?.components ?? [];
  const after = next.components;
  const beforeIdx = new Map(before.map((c, i) => [c.id, i]));
  const afterIds = new Set(after.map((c) => c.id));
  const ops: UIDiffOp[] = [];

  for (const c of before) if (!afterIds.has(c.id)) ops.push({ op: "remove", id: c.id });

  const commonBefore = before.filter((c) => afterIds.has(c.id)).map((c) => c.id);
  const commonAfter = after.filter((c) => beforeIdx.has(c.id)).map((c) => c.id);
  after.forEach((c, index) => {
    const from = beforeIdx.get(c.id);
    if (from === undefined) {
      ops.push({ op: "add", id: c.id, index });
      return;
    }
    if (commonBefore.indexOf(c.id) !== commonAfter.indexOf(c.id)) {
      ops.push({ op: "move", id: c.id, from, to: index });
    }
    const changed = changedProps(before[from] as ComponentInstance, c);
    if (changed.length) ops.push({ op: "update", id: c.id, changedProps: changed });
  });
  return ops;
}
