#!/usr/bin/env node
// One autoresearch round over stored traces (docs/backlog.md#autoresearch, ADR 0009).
// Needs traces saved with MORPH_TRACE_DIR and MORPH_TRACE_LENS=1, a Jev key to answer the new
// questions, and an LLM key to propose them (the MORPH_NARRATIVE_* settings). It writes a report
// and never changes the app's decision set: adding a kept question is a human decision.
// Usage: pnpm research [trace dir] [--dry-run]
//   --dry-run  print the proposal request the LLM would get, and call nothing.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, jsonSchema, Output } from "ai";
// `pnpm research` builds @morph/core first, so the dist files below exist.
import * as core from "../../../packages/core/dist/index.js";
import * as node from "../../../packages/core/dist/node.js";
import { JevProvider } from "../../../packages/core/dist/providers/jev.js";

const env = process.env;
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const dir = resolve(
  args.find((a) => !a.startsWith("--")) ?? env.MORPH_TRACE_DIR ?? ".morph/traces",
);

const { traces, events } = node.readTraceStore(dir);
const turns = core.researchTurns(traces, events);
console.log(`Traces: ${traces.length}, labelled turns with lens state: ${turns.length} (${dir})`);
if (turns.length < 20) {
  console.log(
    "Not enough turns. Run the demo with MORPH_TRACE_DIR and MORPH_TRACE_LENS=1, use it, then retry.",
  );
  process.exit(dryRun ? 0 : 1);
}
const baseSpecs = core.specsFromAnswers(turns);

function proposer() {
  const provider = (env.MORPH_NARRATIVE_PROVIDER || "none").toLowerCase();
  const modelId = env.MORPH_NARRATIVE_MODEL?.trim();
  if (provider !== "anthropic" && provider !== "openai") return null;
  const apiKey = provider === "anthropic" ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY;
  if (!modelId || !apiKey) return null;
  const model =
    provider === "anthropic"
      ? createAnthropic({ apiKey })(modelId)
      : createOpenAI({ apiKey })(modelId);
  return async (req) => {
    const res = await generateText({
      model,
      instructions: req.instructions,
      prompt: req.prompt,
      output: Output.object({ schema: jsonSchema(req.jsonSchema) }),
    });
    return res.output;
  };
}

let shown = null;
const propose = dryRun
  ? async (req) => {
      shown = req;
      return { questions: [] };
    }
  : proposer();
if (!propose) {
  console.error(
    "Set MORPH_NARRATIVE_PROVIDER, MORPH_NARRATIVE_MODEL and its API key to propose questions.",
  );
  process.exit(1);
}
if (!dryRun && !env.TYPESAFE_API_KEY) {
  console.error("Set TYPESAFE_API_KEY so Jev can answer the proposed questions.");
  process.exit(1);
}
const provider = dryRun
  ? { name: "none", calibrated: true, evaluate: async () => ({}) }
  : new JevProvider({ apiKey: env.TYPESAFE_API_KEY, model: env.MORPH_JEV_MODEL || "jev-1.13.0" });

const report = await core.runResearchRound({ turns, baseSpecs, provider, propose });
if (dryRun) {
  console.log(`Baseline held-out accuracy: ${report.baselineAccuracy.toFixed(3)}`);
  console.log(
    shown ? `\n${shown.instructions}\n\n${shown.prompt}` : "\nNo errors to show the LLM.",
  );
  process.exit(0);
}

const out = join(dir, "..", "research");
mkdirSync(out, { recursive: true });
const file = join(out, `round-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `Held-out accuracy ${report.baselineAccuracy.toFixed(3)} → ${report.finalAccuracy.toFixed(3)}`,
);
for (const p of report.proposed)
  console.log(
    `${p.kept ? "KEEP" : "drop"} ${p.spec.id} (gain ${p.gain.toFixed(3)}): ${p.spec.instructions}`,
  );
for (const r of report.rejected) console.log(`rejected ${r.id}: ${r.reason}`);
if (report.proposerError) console.log(`Proposer failed: ${report.proposerError}`);
if (report.providerFailures) console.log(`Jev failed on ${report.providerFailures} turns.`);
console.log(`Report: ${file}\nReview the kept questions before adding any to lib/morph/specs.ts.`);
