import { type FixtureStore, memoryFixtureStore } from "morph-core";
import { fsFixtureStore, readFixtureDir } from "morph-core/node";
import { JevProvider } from "morph-core/providers/jev";
import { MetricsView, TraceView } from "morph-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  checkTurn,
  type Golden,
  type GoldenExpect,
  loadGoldens,
  REPLAY_DIR,
  runScenario,
  type ScenarioOptions,
  type TurnResult,
} from "./runner";

const goldens = loadGoldens();
const live = process.env.MORPH_PROVIDER === "jev";
const record = process.env.MORPH_RECORD === "1";
const jevModel = process.env.MORPH_JEV_MODEL ?? "jev-1.13.0";
const fixtures = readFixtureDir(REPLAY_DIR);

function expectationsFor(
  g: Golden,
  i: number,
  mode: ScenarioOptions["mode"],
): GoldenExpect | undefined {
  const t = g.turns[i];
  if (!t) return undefined;
  if (mode === "rules" && t.rulesExpect) return { ...t.expect, ...t.rulesExpect };
  return t.expect;
}

const refs = new Map<string, TurnResult[]>();

async function runAndCheck(g: Golden, opts: ScenarioOptions): Promise<TurnResult[]> {
  const results = await runScenario(g, opts);
  const failures: string[] = [];
  results.forEach((r, i) => {
    const e = expectationsFor(g, i, opts.mode);
    if (!e) return;
    const ref = e.sameAs ? refs.get(`${e.sameAs}|${opts.mode}`)?.[0] : undefined;
    if (e.sameAs && !ref) failures.push(`turn ${i + 1}: reference ${e.sameAs} has not run`);
    for (const f of checkTurn(r, e, ref)) failures.push(`turn ${i + 1}: ${f}`);
  });
  expect(failures).toEqual([]);
  // M7: every golden trace renders in the inspector.
  const traces = results.flatMap((r) => (r.trace ? [r.trace] : []));
  for (const t of traces) {
    const html = renderToStaticMarkup(createElement(TraceView, { trace: t }));
    expect(html).toContain(`data-gate="${t.gate.outcome.kind}"`);
    for (const id of Object.keys(t.answers)) expect(html).toContain(`data-answer="${id}"`);
  }
  expect(renderToStaticMarkup(createElement(MetricsView, { traces, events: [] }))).toContain(
    "data-metrics",
  );
  refs.set(`${g.id}|${opts.mode}`, results);
  return results;
}

const providerSpecific = (g: Golden) => Boolean(g.given.provider || g.given.providerFailure);

describe("golden scenarios", () => {
  it("covers G01–G13", () => {
    const ids = goldens.map((g) => g.id.slice(0, 3));
    expect(ids).toEqual(Array.from({ length: 13 }, (_, i) => `G${String(i + 1).padStart(2, "0")}`));
  });

  for (const g of goldens) {
    if (g.given.providerFailure) {
      for (const failure of g.given.providerFailure) {
        it(`${g.id} [rules] (primary ${failure})`, async () => {
          await runAndCheck(g, { mode: "rules", failure });
        });
      }
    } else {
      it(`${g.id} [rules]`, async () => {
        await runAndCheck(g, { mode: "rules" });
      });
    }

    if (!providerSpecific(g) && !live) {
      const store = memoryFixtureStore(fixtures);
      it(`${g.id} [${Object.keys(fixtures).length ? "replay" : "replay: no fixtures"}]`, async () => {
        // Probe with intent turns only: a replay miss leaves no pending option to choose.
        const probe = { ...g, turns: g.turns.filter((t) => t.intent !== undefined) };
        const results = await runScenario(probe, { mode: "replay", store, jevModel });
        const missed = results.some((r) => r.trace?.error?.includes("ReplayMissError"));
        if (missed) {
          // No recorded fixtures for this scenario yet: recording needs a key (human-only, GOAL.md §5).
          expect(results.every((r) => r.state.components.length > 0)).toBe(true);
          return;
        }
        await runAndCheck(g, { mode: "replay", store, jevModel });
      });
    }

    if (live && !providerSpecific(g)) {
      it(`${g.id} [live]`, async () => {
        const store: FixtureStore = record ? fsFixtureStore(REPLAY_DIR) : memoryFixtureStore();
        await runAndCheck(g, {
          mode: "live",
          live: new JevProvider({ model: jevModel }),
          record,
          store,
          jevModel,
        });
      });
    }
  }
});
