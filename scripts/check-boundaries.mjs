#!/usr/bin/env node
// Package boundary + forbidden API scan (SPEC §2 I2, I7, I8, I10; §13.5).
// Exits 1 and prints every violation when any rule fails.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "coverage",
  ".git",
  "test-results",
  "playwright-report",
]);
const CODE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (CODE_EXT.test(name)) out.push(full);
  }
  return out;
}

const rel = (f) => relative(root, f).split(sep).join("/");
const violations = [];
const fail = (file, line, msg) => violations.push(`${file}:${line}  ${msg}`);

const files = [
  ...walk(join(root, "packages")),
  ...walk(join(root, "apps")),
  ...walk(join(root, "scripts")),
].filter((f) => !rel(f).endsWith("scripts/check-boundaries.mjs"));

// Files that run only on the server (or in Node tooling) and may import server-only subpaths.
const isServerFile = (r) =>
  /^apps\/demo\/app\/api\//.test(r) ||
  /^apps\/demo\/lib\/server\//.test(r) ||
  /^apps\/demo\/scripts\//.test(r) ||
  /^apps\/demo\/e2e\//.test(r) ||
  /^scripts\//.test(r) ||
  /^packages\/core\//.test(r) ||
  /\.test\.tsx?$/.test(r) ||
  /(^|\/)(vitest|playwright|next)\.config\.[mc]?ts$/.test(r);

const importRe =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;

for (const file of files) {
  const r = rel(file);
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  const inCore = r.startsWith("packages/core/");

  lines.forEach((text, i) => {
    const ln = i + 1;
    // I2: forbidden APIs.
    if (/(^|[^.\w])eval\s*\(/.test(text)) fail(r, ln, "forbidden API: eval (I2)");
    if (/new\s+Function\s*\(/.test(text)) fail(r, ln, "forbidden API: new Function (I2)");
    if (/dangerouslySetInnerHTML/.test(text))
      fail(r, ln, "forbidden API: dangerouslySetInnerHTML (I2)");
    if (/\bimport\s*\(\s*[^'"`\s)]/.test(text))
      fail(r, ln, "dynamic import() of a non-literal (I2)");
    // I8: never allow the TypeSafe SDK in the browser.
    if (/dangerouslyAllowBrowser/.test(text))
      fail(r, ln, "dangerouslyAllowBrowser is forbidden (I8)");
    // I10: never use the unpinned model alias.
    if (/jev-latest/.test(text)) fail(r, ln, "unpinned model alias jev-latest (I10)");

    for (const m of text.matchAll(importRe)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (!spec) continue;
      // I7: core is framework-neutral.
      if (inCore && (/^react(-dom)?(\/|$)/.test(spec) || /^next(\/|$)/.test(spec))) {
        fail(r, ln, `framework import "${spec}" in morph-core (I7)`);
      }
      // I8: server-only subpaths must not reach client code.
      if (/^morph-core\/(providers\/jev|node)(\/|$)/.test(spec) && !isServerFile(r)) {
        fail(r, ln, `server-only import "${spec}" in client code (I8)`);
      }
      if (/^(@typesafe-ai\/sdk|@ai-sdk\/|ai$)/.test(spec) && !isServerFile(r)) {
        fail(r, ln, `server-only SDK "${spec}" in client code (I8)`);
      }
      if (inCore && !/providers\/jev\//.test(r) && /^@typesafe-ai\/sdk/.test(spec)) {
        fail(r, ln, "@typesafe-ai/sdk may only be imported under providers/jev (I8)");
      }
      if (inCore && !/src\/node\//.test(r) && /^node:/.test(spec) && !/\.test\.ts$/.test(r)) {
        fail(r, ln, `Node built-in "${spec}" outside morph-core/node (I7)`);
      }
    }
  });

  // Core public entry must not re-export server-only subpaths.
  if (
    r === "packages/core/src/index.ts" &&
    /^\s*export[^\n]*from\s*["'][^"']*(providers\/jev|\/node)["']/m.test(src)
  ) {
    fail(r, 1, "packages/core/src/index.ts re-exports the jev or node subpath");
  }
}

// I7: core tsconfig must not include DOM.
const coreTs = JSON.parse(readFileSync(join(root, "packages/core/tsconfig.json"), "utf8"));
const libs = coreTs.compilerOptions?.lib ?? [];
if (!Array.isArray(libs) || libs.length === 0 || libs.some((l) => /dom/i.test(l))) {
  fail("packages/core/tsconfig.json", 1, "core tsconfig lib must be set and exclude DOM (I7)");
}

if (violations.length > 0) {
  console.error(`check:boundaries found ${violations.length} violation(s):`);
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
console.log(`check:boundaries OK (${files.length} files scanned)`);
