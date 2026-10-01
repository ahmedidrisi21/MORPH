import { fnv1a64 } from "../cache/fnv";
import type { JsonValue } from "../context/types";

export const DEFAULT_TEXT_DIMS = 1024;

/** Lower-case word tokens (letters and digits). */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function bucket(feature: string, dims: number): number {
  return Number(BigInt(`0x${fnv1a64(feature)}`) % BigInt(dims));
}

/**
 * Hashed bag of words and word pairs for every string in a lens state, prefixed by its key
 * (`intent:why`, `current_workspace:revenue`), L2-normalised. Numbers and booleans are ignored.
 */
export function stateTextFeatures(state: JsonValue, dims = DEFAULT_TEXT_DIMS): number[] {
  const v = new Array<number>(dims).fill(0);
  const add = (key: string, text: string) => {
    const t = tokenize(text);
    t.forEach((w, i) => {
      const f1 = bucket(`${key}:${w}`, dims);
      v[f1] = (v[f1] as number) + 1;
      if (i > 0) {
        const f2 = bucket(`${key}:${t[i - 1]}_${w}`, dims);
        v[f2] = (v[f2] as number) + 1;
      }
    });
  };
  const walk = (key: string, x: JsonValue) => {
    if (typeof x === "string") add(key, x);
    else if (Array.isArray(x)) for (const item of x) walk(key, item);
    else if (x && typeof x === "object") for (const [k, y] of Object.entries(x)) walk(k, y);
  };
  walk("state", state);
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
}
