import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJSON } from "../cache/canonical";
import type { FixtureRecord, FixtureStore } from "../providers/replay";

/** Pretty-printed JSON with sorted keys, so fixture diffs are reviewable. */
export function stableStringify(value: unknown): string {
  return `${JSON.stringify(JSON.parse(canonicalJSON(value)), null, 2)}\n`;
}

/** One JSON file per key under `dir`. For local record mode only; never read at request time in production. */
export function fsFixtureStore(dir: string): FixtureStore {
  return {
    get(key) {
      try {
        return JSON.parse(readFileSync(join(dir, `${key}.json`), "utf8")) as FixtureRecord;
      } catch {
        return undefined;
      }
    },
    set(key, value) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${key}.json`), stableStringify(value));
    },
  };
}

/** Load every fixture in `dir` into a plain object (used to compile fixtures for bundling). */
export function readFixtureDir(dir: string): Record<string, FixtureRecord> {
  const out: Record<string, FixtureRecord> = {};
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return out;
  }
  for (const f of files.sort()) {
    const rec = JSON.parse(readFileSync(join(dir, f), "utf8")) as FixtureRecord;
    out[rec.key ?? f.replace(/\.json$/, "")] = rec;
  }
  return out;
}

export { jsonlTraceStore, readTraceStore, type TraceStore, TraceStoreFullError } from "./traces";
