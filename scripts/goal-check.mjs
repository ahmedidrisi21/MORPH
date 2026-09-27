#!/usr/bin/env node
// The finish line (GOAL.md §2). Runs every check in order, prints a ✅/❌ table,
// and ends with exactly one of:
//   GOAL MET
//   GOAL MET (AGENT SCOPE) — waiting on human: <items>
//   GOAL NOT MET — next: <first failing check>
//
// Never edit this file to make a failing check pass. Only add checks or make them stricter.
// Usage: node scripts/goal-check.mjs [--only G1,G5]
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const onlyArg = process.argv.find((a) => a.startsWith("--only"));
const only = onlyArg
  ? new Set(
      (onlyArg.includes("=")
        ? onlyArg.split("=")[1]
        : process.argv[process.argv.indexOf(onlyArg) + 1]
      ).split(","),
    )
  : null;

// Keys must never be present while checking: the goal is zero-key operation (I9).
const cleanEnv = { ...process.env, CI: "1", FORCE_COLOR: "0" };
for (const k of [
  "TYPESAFE_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "MORPH_PROVIDER",
  "MORPH_RECORD",
]) {
  delete cleanEnv[k];
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd ?? root,
    env: opts.env ?? cleanEnv,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: opts.timeout ?? 20 * 60 * 1000,
    shell: false,
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  return { ok: res.status === 0, code: res.status, out };
}

const tail = (s, n = 15) => s.trim().split("\n").slice(-n).join("\n");

function walk(dir, filter, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", "dist", "coverage", ".git"].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
}
const rel = (f) => relative(root, f).split(sep).join("/");

// ---------------------------------------------------------------------------
// Checks. Each returns { ok, detail, human?: string[] }.
// ---------------------------------------------------------------------------

function g1() {
  const r = run("pnpm", ["install", "--frozen-lockfile"]);
  return { ok: r.ok, detail: r.ok ? "pnpm install --frozen-lockfile exited 0" : tail(r.out) };
}

function g2() {
  const r = run("pnpm", ["verify"]);
  return { ok: r.ok, detail: r.ok ? "pnpm verify exited 0" : tail(r.out, 30) };
}

const GOLDEN_IDS = Array.from({ length: 13 }, (_, i) => `G${String(i + 1).padStart(2, "0")}`);

function g3() {
  const goldenDir = join(root, "fixtures/golden");
  const files = existsSync(goldenDir)
    ? readdirSync(goldenDir).filter((f) => f.endsWith(".json"))
    : [];
  const missing = GOLDEN_IDS.filter((id) => !files.some((f) => f.startsWith(`${id}-`)));
  if (missing.length)
    return { ok: false, detail: `missing golden scenarios: ${missing.join(", ")}` };
  const outFile = join(mkdtempSync(join(tmpdir(), "morph-golden-")), "report.json");
  const r = run("pnpm", [
    "exec",
    "vitest",
    "run",
    "--config",
    "vitest.golden.config.ts",
    "--reporter=json",
    `--outputFile=${outFile}`,
  ]);
  if (!existsSync(outFile)) return { ok: false, detail: tail(r.out) };
  const report = JSON.parse(readFileSync(outFile, "utf8"));
  const tests = report.testResults.flatMap((f) => f.assertionResults);
  const failed = tests.filter((t) => t.status !== "passed");
  if (failed.length) {
    return {
      ok: false,
      detail: `failing: ${failed
        .map((t) => t.fullName)
        .slice(0, 5)
        .join("; ")}`,
    };
  }
  const noRules = GOLDEN_IDS.filter(
    (id) =>
      !tests.some(
        (t) => t.status === "passed" && t.fullName.includes(id) && t.fullName.includes("[rules]"),
      ),
  );
  if (noRules.length)
    return { ok: false, detail: `no passing [rules] run for: ${noRules.join(", ")}` };
  const replay = GOLDEN_IDS.filter((id) =>
    tests.some(
      (t) => t.status === "passed" && t.fullName.includes(id) && t.fullName.includes("[replay]"),
    ),
  );
  return {
    ok: true,
    detail: `${GOLDEN_IDS.length}/13 pass on rules; ${replay.length}/13 pass on replay`,
  };
}

function g4() {
  const r = run("pnpm", ["test:e2e"]);
  return {
    ok: r.ok,
    detail: r.ok ? "Playwright 4-turn script, alternate and undo passed" : tail(r.out, 25),
  };
}

function g5() {
  const r = run("pnpm", ["build"]);
  return { ok: r.ok, detail: r.ok ? "pnpm build exited 0" : tail(r.out, 25) };
}

function g6() {
  const dir = join(root, "apps/demo/.next/static");
  if (!existsSync(dir))
    return { ok: false, detail: "apps/demo/.next/static missing (run G5 first)" };
  const files = walk(dir, () => true);
  const patterns = [
    ["@typesafe-ai/sdk", /@typesafe-ai\/sdk|TypeSafeClient|api\.typesafe\.ai/],
    ["@ai-sdk/", /@ai-sdk\//],
    ["TYPESAFE_API_KEY", /TYPESAFE_API_KEY/],
    ["sk- key", /\bsk-[A-Za-z0-9_-]{16,}/],
  ];
  const hits = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const [name, re] of patterns) if (re.test(text)) hits.push(`${name} in ${rel(f)}`);
  }
  return hits.length
    ? { ok: false, detail: hits.slice(0, 5).join("; ") }
    : { ok: true, detail: `${files.length} static files scanned, no SDK code or keys` };
}

function g7() {
  const r = run("pnpm", [
    "exec",
    "vitest",
    "run",
    "--coverage",
    "--coverage.reporter=json-summary",
    "--coverage.reportsDirectory=coverage/core",
  ]);
  const summaryFile = join(root, "coverage/core/coverage-summary.json");
  if (!existsSync(summaryFile)) return { ok: false, detail: tail(r.out) };
  const { total } = JSON.parse(readFileSync(summaryFile, "utf8"));
  const lines = total.lines.pct;
  const branches = total.branches.pct;
  const ok = r.ok && lines >= 85 && branches >= 80;
  return { ok, detail: `packages/core lines ${lines}% (≥85), branches ${branches}% (≥80)` };
}

function g8() {
  if (!existsSync(join(root, "scripts/check-pack.mjs")))
    return { ok: false, detail: "scripts/check-pack.mjs missing" };
  const r = run("node", ["scripts/check-pack.mjs"]);
  return { ok: r.ok, detail: r.ok ? tail(r.out, 1) : tail(r.out) };
}

function adrJustifies(file, line) {
  const m = line.match(/ADR-(\d{4})/);
  if (!m) return false;
  const dir = join(root, "docs/decisions");
  if (!existsSync(dir)) return false;
  const adr = readdirSync(dir).find((f) => f.startsWith(`${m[1]}-`));
  return Boolean(adr && readFileSync(join(dir, adr), "utf8").includes(file));
}

function g9() {
  const isCode = (f) => /\.(ts|tsx|mts|js|mjs)$/.test(f);
  const files = [
    ...walk(join(root, "packages"), (f) => isCode(f) && /\/src\//.test(f)),
    ...walk(join(root, "apps/demo"), (f) => isCode(f) && /(\.test\.|\/e2e\/|\/test\/)/.test(f)),
    ...walk(join(root, "tests"), isCode),
  ];
  const re = /\.(skip|only)\s*\(|\b(xit|xdescribe|xtest)\s*\(|@ts-ignore|@ts-nocheck|biome-ignore/;
  const hits = [];
  for (const f of files) {
    readFileSync(f, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (re.test(line) && !adrJustifies(rel(f), line)) hits.push(`${rel(f)}:${i + 1}`);
      });
  }
  return hits.length
    ? { ok: false, detail: `unjustified: ${hits.slice(0, 8).join(", ")}` }
    : { ok: true, detail: `${files.length} files scanned` };
}

function g10() {
  const files = walk(join(root, "packages"), (f) => /\/src\//.test(f) && /\.(ts|tsx)$/.test(f));
  const backlogFile = join(root, "docs/backlog.md");
  const backlog = existsSync(backlogFile) ? readFileSync(backlogFile, "utf8") : "";
  const hits = [];
  for (const f of files) {
    readFileSync(f, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (!/\b(TODO|FIXME)\b/.test(line)) return;
        const ref = line.match(/backlog\.md#([\w-]+)/);
        if (
          !ref ||
          !new RegExp(`\\{#${ref[1]}\\}|<a id="${ref[1]}"|^#+ .*${ref[1]}`, "m").test(backlog)
        ) {
          hits.push(`${rel(f)}:${i + 1}`);
        }
      });
  }
  return hits.length
    ? { ok: false, detail: `unreferenced TODO/FIXME: ${hits.slice(0, 8).join(", ")}` }
    : { ok: true, detail: `${files.length} source files scanned` };
}

// Acceptance items per milestone, parsed from SPEC §14.
function specAcceptance() {
  const spec = readFileSync(join(root, "SPEC.md"), "utf8");
  const section = spec.split(/^## 14\. Milestones/m)[1]?.split(/^## 15\./m)[0] ?? "";
  const out = {};
  for (const block of section.split(/^### /m).slice(1)) {
    const id = block.match(/^(M\d)/)?.[1];
    if (!id) continue;
    const acc = block.split("**Acceptance**")[1]?.split(/\*\*Tests/)[0] ?? "";
    out[id] = [...acc.matchAll(/^- \[ \] (.+)$/gm)].map((m) => m[1].trim());
  }
  return out;
}

const norm = (s) =>
  s
    .replace(/^HUMAN:\s*/, "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

function g11() {
  const file = join(root, "docs/progress.md");
  if (!existsSync(file)) return { ok: false, detail: "docs/progress.md missing" };
  const progress = readFileSync(file, "utf8");
  const acceptance = specAcceptance();
  const problems = [];
  const human = [];
  for (let n = 0; n <= 8; n++) {
    const id = `M${n}`;
    const section = progress.split(new RegExp(`^## ${id}\\b`, "m"))[1]?.split(/^## /m)[0];
    if (section === undefined) {
      problems.push(`${id} section missing`);
      continue;
    }
    const heading = progress.match(new RegExp(`^## ${id}\\b.*$`, "m"))[0];
    if (!/✅ done/.test(heading)) problems.push(`${id} not marked done`);
    const checked = [...section.matchAll(/^- \[x\] (.+)$/gim)].map((m) => norm(m[1]));
    const unchecked = [...section.matchAll(/^- \[ \] (.+)$/gm)].map((m) => m[1].trim());
    for (const item of acceptance[id] ?? []) {
      const key = norm(item);
      if (checked.some((c) => c.startsWith(key.slice(0, 50)))) continue;
      const pendingHuman = unchecked.find(
        (u) => /^HUMAN:/.test(u) && norm(u).startsWith(key.slice(0, 50)),
      );
      if (pendingHuman) human.push(`${id}: ${item}`);
      else problems.push(`${id}: "${item.slice(0, 50)}" not checked`);
    }
  }
  // Human-only items listed anywhere in progress.md (GOAL.md §5).
  for (const m of progress.matchAll(/^- \[ \] HUMAN: (.+)$/gm)) {
    const text = m[1].trim();
    if (!human.some((h) => norm(h).includes(norm(text).slice(0, 40)))) human.push(text);
  }
  if (problems.length) return { ok: false, detail: problems.slice(0, 6).join("; "), human };
  return {
    ok: true,
    detail: "M0–M8 marked done; every acceptance box checked or human-only",
    human,
  };
}

async function waitForHttp(url, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function g12() {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const quick = readme.split(/^## Quickstart/m)[1]?.split(/^## /m)[0];
  if (!quick) return { ok: false, detail: "README has no Quickstart section" };
  const block = quick.match(/```bash\n([\s\S]*?)```/)?.[1];
  if (!block) return { ok: false, detail: "Quickstart has no bash block" };
  const cmds = block
    .split("\n")
    .map((l) => l.replace(/\s+#.*$/, "").trim())
    .filter(Boolean);
  const work = mkdtempSync(join(tmpdir(), "morph-readme-"));
  let cwd = work;
  const log = [];
  try {
    for (const cmd of cmds) {
      const parts = cmd.split(/\s+/);
      if (parts[0] === "git" && parts[1] === "clone") {
        // Clone this checkout (not the network copy) so the check covers the working tree's commits.
        const dest =
          parts[3] ??
          parts[2]
            .split("/")
            .pop()
            .replace(/\.git$/, "");
        const r = run("git", ["clone", "--quiet", root, dest], { cwd });
        if (!r.ok) return { ok: false, detail: `"${cmd}" failed: ${tail(r.out, 5)}` };
        log.push(cmd);
      } else if (parts[0] === "cd") {
        cwd = join(cwd, parts[1]);
        if (!existsSync(cwd)) return { ok: false, detail: `"${cmd}": directory missing` };
        log.push(cmd);
      } else if (cmd === "pnpm dev") {
        const child = spawn("pnpm", ["dev"], {
          cwd,
          env: cleanEnv,
          stdio: "ignore",
          detached: true,
        });
        const up = await waitForHttp("http://localhost:3000", 180_000);
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          // already exited
        }
        if (!up) return { ok: false, detail: '"pnpm dev" did not serve http://localhost:3000' };
        log.push(cmd);
      } else {
        const r = run("sh", ["-c", cmd], { cwd });
        if (!r.ok) return { ok: false, detail: `"${cmd}" failed: ${tail(r.out, 5)}` };
        log.push(cmd);
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return { ok: true, detail: `ran: ${log.join(" → ")}` };
}

const checks = [
  ["G1", "Clean install works", g1],
  ["G2", "Full verification", g2],
  ["G3", "Golden scenarios", g3],
  ["G4", "End-to-end demo", g4],
  ["G5", "Production build", g5],
  ["G6", "No keys in the browser", g6],
  ["G7", "Core coverage", g7],
  ["G8", "Package works standalone", g8],
  ["G9", "No cheating", g9],
  ["G10", "No loose ends", g10],
  ["G11", "Progress is complete", g11],
  ["G12", "Docs match reality", g12],
];

const results = [];
for (const [id, name, fn] of checks) {
  if (only && !only.has(id)) continue;
  process.stderr.write(`… ${id} ${name}\n`);
  let res;
  try {
    res = await fn();
  } catch (err) {
    res = {
      ok: false,
      detail: `check crashed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  results.push({ id, name, ...res });
}

console.log("\n| # | Check | Result | Detail |\n|---|---|---|---|");
for (const r of results) {
  const detail = r.detail.replace(/\n/g, " ⏎ ").replace(/\|/g, "\\|").slice(0, 400);
  console.log(`| ${r.id} | ${r.name} | ${r.ok ? "✅" : "❌"} | ${detail} |`);
}
console.log("");

const failed = results.filter((r) => !r.ok);
const human = results.flatMap((r) => r.human ?? []);
if (only) {
  console.log(
    failed.length
      ? `PARTIAL RUN — failing: ${failed.map((r) => r.id).join(", ")}`
      : "PARTIAL RUN — all selected checks passed",
  );
  process.exit(failed.length ? 1 : 0);
} else if (failed.length) {
  console.log(`GOAL NOT MET — next: ${failed[0].id} ${failed[0].name}`);
  process.exit(1);
} else if (human.length) {
  console.log(`GOAL MET (AGENT SCOPE) — waiting on human: ${human.join("; ")}`);
} else {
  console.log("GOAL MET — every check passed.");
}
