#!/usr/bin/env node
// Compile fixtures/replay/*.json into lib/morph/fixtures.generated.json (SPEC Appendix B).
// Serverless file systems only bundle traced files, so the decide route imports this JSON
// instead of reading fixtures from disk at request time.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const demo = fileURLToPath(new URL("..", import.meta.url));
const src = join(demo, "..", "..", "fixtures", "replay");
const out = join(demo, "lib", "morph", "fixtures.generated.json");

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortDeep(value[k])]),
    );
  }
  return value;
}

let files = [];
try {
  files = readdirSync(src)
    .filter((f) => f.endsWith(".json"))
    .sort();
} catch {
  // No fixtures recorded yet: compile an empty store.
}

const fixtures = {};
for (const f of files) {
  const rec = JSON.parse(readFileSync(join(src, f), "utf8"));
  fixtures[rec.key ?? f.replace(/\.json$/, "")] = rec;
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(sortDeep(fixtures), null, 2)}\n`);
console.log(`compile-fixtures: ${files.length} fixture(s) → ${out.slice(demo.length)}`);
