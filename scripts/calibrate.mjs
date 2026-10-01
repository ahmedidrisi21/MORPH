#!/usr/bin/env node
// Suggest gate thresholds from stored traces (docs/backlog.md#threshold-calibration, ADR 0008).
// Prints a report and a suggested `gate` config per model version. It never edits any config.
// Usage: pnpm calibrate [trace dir] [--min-samples N] [--json]
// The trace dir defaults to MORPH_TRACE_DIR, then .morph/traces.
// `pnpm calibrate` builds morph-core first, so the dist files below exist.
import { resolve } from "node:path";
import * as core from "../packages/core/dist/index.js";
import * as node from "../packages/core/dist/node.js";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--min"));
const dir = resolve(positional[0] ?? process.env.MORPH_TRACE_DIR ?? ".morph/traces");
const minSamples = flag("--min-samples") ? Number(flag("--min-samples")) : undefined;

const { traces, events, skipped } = node.readTraceStore(dir);
const models = core.calibrateGate(traces, events, minSamples ? { minSamples } : {});

if (args.includes("--json")) {
  console.log(
    JSON.stringify(
      { dir, traces: traces.length, events: events.length, skipped, models },
      (_k, v) => (v === Number.POSITIVE_INFINITY ? "Infinity" : v),
      2,
    ),
  );
  process.exit(0);
}

console.log(`Traces: ${traces.length}, events: ${events.length} from ${dir}`);
if (skipped) console.log(`Skipped ${skipped} malformed lines.`);
if (traces.length === 0) {
  console.log("Nothing to calibrate. Set MORPH_TRACE_DIR, use the demo, then run this again.");
  process.exit(0);
}
const s = core.summarize(traces, events);
const pct = (x) => `${Math.round(x * 100)}%`;
console.log(
  `Override ${pct(s.overrideRate)}, unwanted morphs ${pct(s.unwantedMorphRate)}, clarify ${pct(s.clarifyRate)}, fallback ${pct(s.fallbackRate)}, p50 ${s.p50TotalMs} ms, p95 ${s.p95TotalMs} ms`,
);
for (const m of models) {
  console.log(`\nModel ${m.model} (${m.traces} traces)`);
  console.log("| Risk | Outcomes | Current | Suggested | Kept at or above |");
  console.log("|---|---|---|---|---|");
  for (const r of m.risks) {
    console.log(
      `| ${r.risk} | ${r.samples} | ${r.current} | ${r.suggested} | ${pct(r.acceptedAbove)} of ${r.samplesAbove} |`,
    );
  }
  for (const r of m.risks) console.log(`- ${r.risk}: ${r.note}`);
  const { critical: _critical, ...shown } = m.gate.autoThreshold;
  console.log(`Suggested: createMorph({ gate: { autoThreshold: ${JSON.stringify(shown)} } })`);
}
console.log(
  "\nThese are suggestions only. Before applying them or upgrading the model, replay the goldens:" +
    "\n  pnpm test:golden" +
    "\n  MORPH_RECORD=1 pnpm test:golden:live   # new model version: re-record fixtures (needs a key)",
);
