#!/usr/bin/env node
// Train the offline classifier from stored traces (docs/backlog.md#distilled-classifier, ADR 0009).
// It learns to mimic the answers a calibrated provider (Jev) gave to the same lens states, so the
// demo can answer with MORPH_PROVIDER=distilled and no network. Needs traces saved with
// MORPH_TRACE_DIR and MORPH_TRACE_LENS=1.
// Usage: pnpm distill [trace dir] [--out file] [--teacher any]
//   --teacher any  also learn from uncalibrated answers (rules/replay), e.g. to try it locally.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
// `pnpm distill` builds @morph/core first, so the dist files below exist.
import * as core from "../../../packages/core/dist/index.js";
import * as node from "../../../packages/core/dist/node.js";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const dir = resolve(positional[0] ?? process.env.MORPH_TRACE_DIR ?? ".morph/traces");
const outFile = resolve(flag("--out") ?? ".morph/distilled.json");
const anyTeacher = flag("--teacher") === "any";

const { traces } = node.readTraceStore(dir);
const examples = [];
const teachers = new Set();
for (const t of traces) {
  const state = t.lensStates.core?.content;
  if (state === undefined) continue;
  const answers = Object.fromEntries(
    Object.entries(t.answers).filter(([, a]) => anyTeacher || a.meta.calibrated),
  );
  if (Object.keys(answers).length === 0) continue;
  for (const a of Object.values(answers)) teachers.add(a.meta.model ?? a.meta.provider);
  examples.push({ state, answers });
}
console.log(`Traces: ${traces.length}, usable examples: ${examples.length} (${dir})`);
if (examples.length < 20) {
  console.error(
    "Not enough examples. Run the demo with MORPH_TRACE_DIR, MORPH_TRACE_LENS=1 and Jev, then retry.",
  );
  process.exit(1);
}
const teacher = [...teachers].sort().join("+");
const model = core.trainDistilled(examples, core.specsFromAnswers(examples), { teacher });
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(model)}\n`);
for (const [id, m] of Object.entries(model.specs)) console.log(`${id}: ${m.examples} examples`);
console.log(`Wrote ${outFile} (teacher ${teacher}).`);
console.log("Use it with MORPH_DISTILLED_MODEL and MORPH_PROVIDER=distilled (or as a fallback).");
