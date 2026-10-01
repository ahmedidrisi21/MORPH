#!/usr/bin/env node
// G8: pack morph-core, install the tarball into a fresh temp app with npm, and resolve a
// rules-only workspace there. Proves the published exports map, dist files and deps work
// outside the monorepo. Usage: node scripts/check-pack.mjs [--keep]
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const coreDir = join(root, "packages/core");
const keep = process.argv.includes("--keep");

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function fail(msg) {
  console.error(`check-pack: FAIL ${msg}`);
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), "morph-pack-"));
try {
  run("pnpm", ["--filter", "morph-core", "build"], root);
  run("pnpm", ["pack", "--pack-destination", tmp], coreDir);
  const tgz = readdirSync(tmp).find((f) => f.endsWith(".tgz"));
  if (!tgz) fail("pnpm pack produced no tarball");

  const corePkg = JSON.parse(readFileSync(join(coreDir, "package.json"), "utf8"));
  const app = join(tmp, "app");
  mkdirSync(app);
  writeFileSync(
    join(app, "package.json"),
    JSON.stringify(
      {
        name: "morph-pack-check",
        private: true,
        type: "module",
        dependencies: { "morph-core": `file:../${tgz}`, zod: corePkg.dependencies.zod },
      },
      null,
      2,
    ),
  );
  run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], app);

  // The installed manifest must point at built files only.
  const installed = join(app, "node_modules/morph-core");
  const pkg = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  const text = JSON.stringify(pkg);
  if (text.includes("workspace:")) fail("packed package.json still has workspace: ranges");
  if (text.includes("./src/")) fail("packed exports still point at ./src");
  for (const sub of [".", "./providers/jev", "./node"]) {
    const entry = pkg.exports?.[sub];
    if (!entry?.import || !entry?.types) fail(`exports["${sub}"] needs import and types`);
    for (const f of [entry.import, entry.types]) {
      if (!existsSync(join(installed, f))) fail(`exports["${sub}"] → ${f} is missing`);
    }
  }
  if (existsSync(join(installed, "src"))) fail("tarball ships src/");

  writeFileSync(join(app, "app.mjs"), appSource());
  const out = run("node", ["app.mjs"], app).trim();
  if (!out.startsWith("OK ")) fail(`consumer app printed: ${out}`);
  console.log(`check-pack: ${out} (${tgz})`);
} catch (e) {
  const err = /** @type {{ stderr?: string, message: string }} */ (e);
  fail(err.stderr?.trim() || err.message);
} finally {
  if (keep) console.log(`check-pack: kept ${tmp}`);
  else rmSync(tmp, { recursive: true, force: true });
}

// A consumer that knows nothing about the monorepo: plain ESM, rules provider, no keys.
function appSource() {
  return `
import { CapabilityRegistry, createMorph, keywordRule, RulesProvider } from "morph-core";
import { stableStringify } from "morph-core/node";
import { JevProvider } from "morph-core/providers/jev";
import { z } from "zod";

if (typeof JevProvider !== "function" || typeof stableStringify !== "function") {
  throw new Error("subpath exports did not load");
}

const registry = new CapabilityRegistry([
  { type: "kpi", description: "A number", props: z.object({ label: z.string(), value: z.number() }), risk: "low" },
]);
const tree = {
  id: "root",
  description: "",
  question: "Which kind of workspace best supports the \`intent\`?",
  children: [
    { id: "overview", description: "A general summary.", children: [{ id: "overview.default", description: "Summary." }] },
    { id: "investigation", description: "Explains why a metric changed.", children: [{ id: "investigation.by_time", description: "Over time." }] },
  ],
};
const leaf = (leafId) => ({
  leafId,
  layout: leafId.split(".")[0],
  title: () => leafId,
  requiresData: [],
  required: [leafId + ":kpi:revenue"],
  supportsFilters: [],
  build: () => [{ id: leafId + ":kpi:revenue", type: "kpi", props: { label: "Revenue", value: 1 }, slot: "header", priority: 0 }],
});
const specs = [
  {
    id: "turn_type",
    kind: "choice",
    instructions: "Using \`intent\` and \`current_workspace\`, how does this request relate to what the user sees?",
    lens: "core",
    options: { new_topic: "A new view.", refine_current: "Narrows the current view.", unclear: "Too vague." },
  },
];
const provider = new RulesProvider({
  rules: {
    turn_type: keywordRule([{ label: "new_topic", pattern: /why/i }], { otherwise: "unclear" }),
    "ws.root": keywordRule([{ label: "investigation", pattern: /why/i }], { otherwise: "overview" }),
  },
});
const morph = createMorph({ registry, templates: [leaf("overview.default"), leaf("investigation.by_time")], tree, specs, provider });
const facts = { datasetId: "pack", items: [], capabilities: [], filters: {} };
const res = await morph.resolve({
  intent: { raw: "Why did revenue fall?", history: [] },
  user: { role: "viewer", permissions: [] },
  ui: { workspaceId: "overview.default", componentIds: [], lastMorphAt: null, activeFilter: null },
  facts,
  now: Date.now(),
});
if (res.trace.error) throw new Error(res.trace.error);
console.log("OK " + res.outcome.kind + " " + res.state.workspaceId);
`;
}
