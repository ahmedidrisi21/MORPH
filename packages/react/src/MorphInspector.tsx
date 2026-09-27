import type { Answer, DecisionTrace, GateOutcome, TimedEvent } from "@morph/core";
import { summarize } from "@morph/core";
import { type ReactNode, useEffect, useState } from "react";
import { useMorphContext } from "./context";

const EMPTY_TRACES: DecisionTrace[] = [];
const EMPTY_EVENTS: TimedEvent[] = [];

/**
 * Dev panel (SPEC §11.6, M7). Opens with `?inspect=1` or Ctrl+. and reads the ring-buffer sink.
 * Renders trace data as text only: nothing from a trace is ever treated as markup.
 */
export function MorphInspector() {
  const { sink, lastTrace, inspectorOpen, setInspectorOpen, focusComponent, setFocusComponent } =
    useMorphContext();

  // Read ?inspect=1 once on mount, so Close keeps the panel closed.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("inspect") === "1") setInspectorOpen(true);
  }, [setInspectorOpen]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === ".") {
        e.preventDefault();
        setInspectorOpen(!inspectorOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inspectorOpen, setInspectorOpen]);

  // Re-render on every trace or event written to the sink.
  const [, setTick] = useState(0);
  useEffect(() => sink?.subscribe(() => setTick((n) => n + 1)), [sink]);
  const traces = sink ? sink.traces() : EMPTY_TRACES;
  const events = sink ? sink.events() : EMPTY_EVENTS;
  const [selected, setSelected] = useState<string | null>(null);
  const trace =
    (selected ? traces.find((t) => t.id === selected) : undefined) ??
    traces[traces.length - 1] ??
    lastTrace ??
    null;

  if (!inspectorOpen) return null;

  const exportJSON = () => {
    if (!sink) return;
    const blob = new Blob([sink.exportJSON()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "morph-traces.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside
      aria-label="MORPH inspector"
      data-inspector
      className="fixed inset-x-0 bottom-0 z-40 max-h-[70vh] overflow-y-auto border-t border-slate-300 bg-white p-4 text-xs text-slate-800 shadow-2xl sm:inset-x-auto sm:right-0 sm:top-0 sm:max-h-none sm:w-[26rem] sm:border-l sm:border-t-0"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-sm font-semibold">Inspector</h2>
        {traces.length > 1 ? (
          <select
            aria-label="Trace"
            value={trace?.id ?? ""}
            onChange={(e) => setSelected(e.target.value)}
            className="max-w-[12rem] rounded border border-slate-300 px-1 py-0.5"
          >
            {traces.map((t) => (
              <option key={t.id} value={t.id}>
                {t.intent || t.trigger}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          onClick={exportJSON}
          disabled={!sink}
          className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-100"
        >
          Export JSON
        </button>
        <button
          type="button"
          onClick={() => {
            setInspectorOpen(false);
            setFocusComponent(null);
          }}
          className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-100"
        >
          Close
        </button>
      </div>
      {focusComponent ? (
        <p className="mb-3 rounded bg-indigo-50 p-2 text-indigo-800" data-focus={focusComponent}>
          Why this: <code>{focusComponent}</code> is part of the path below.
        </p>
      ) : null}
      {trace ? (
        <TraceView trace={trace} />
      ) : (
        <p className="text-slate-500">No decisions yet. Ask something.</p>
      )}
      {sink ? <MetricsView traces={traces} events={events} /> : null}
    </aside>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-3">
      <h3 className="mb-1 font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

function Bar({ p }: { p: number }) {
  const pct = Math.max(0, Math.min(1, p)) * 100;
  return (
    <span className="inline-block h-1.5 w-20 rounded bg-slate-200 align-middle">
      <span className="block h-1.5 rounded bg-indigo-500" style={{ width: `${pct}%` }} />
    </span>
  );
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

function answerRows(a: Answer): [string, number][] {
  if (a.kind === "choice") {
    return Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]);
  }
  if (a.kind === "score") {
    return Object.entries(a.probabilities).map(([k, v]) => [k, v] as [string, number]);
  }
  return [
    ["yes", a.p],
    ["no", 1 - a.p],
  ];
}

function answerTop(a: Answer): string {
  if (a.kind === "choice") return a.value;
  if (a.kind === "score") return a.expected.toFixed(2);
  return a.p > 0.5 ? "yes" : "no";
}

export function describeOutcome(o: GateOutcome): string {
  switch (o.kind) {
    case "auto":
    case "confirm":
      return `${o.kind} → ${o.target.leafId}`;
    case "alternates":
      return `alternates → ${o.options.map((c) => c.leafId).join(" | ")}`;
    case "clarify":
      return `clarify → ${[...o.options.map((c) => c.leafId), ...(o.filters ?? [])].join(" | ")}`;
    case "refine":
      return `refine → ${o.filter}`;
    case "stay":
      return `stay (${o.reason})`;
  }
}

/** One decision, as text. Exported so tests can render every golden trace. */
export function TraceView({ trace }: { trace: DecisionTrace }) {
  const models = [
    ...new Set(trace.batches.map((b) => `${b.provider}${b.model ? `:${b.model}` : ""}`)),
  ];
  return (
    <div data-trace={trace.id}>
      <Section title="Intent">
        <p>
          “{trace.intent}” <span className="text-slate-500">({trace.trigger})</span>
        </p>
      </Section>
      <Section title="Gate">
        <p data-gate={trace.gate.outcome.kind}>{describeOutcome(trace.gate.outcome)}</p>
        <p className="text-slate-500">{trace.gate.reason}</p>
        {trace.error ? <p className="text-red-700">Provider error: {trace.error}</p> : null}
      </Section>
      <Section title="Answers">
        <ul className="flex flex-col gap-1.5">
          {Object.entries(trace.answers).map(([id, a]) => (
            <li key={id} data-answer={id}>
              <div className="flex justify-between gap-2">
                <code>{id}</code>
                <span>
                  {answerTop(a)}
                  {"confidence" in a ? ` · conf ${pct(a.confidence)}` : ""}
                  {` · ${a.meta.provider}${a.meta.cached ? " (cached)" : ""}`}
                </span>
              </div>
              <ul>
                {answerRows(a)
                  .slice(0, 4)
                  .map(([k, p]) => (
                    <li key={k} className="flex items-center gap-2 text-slate-600">
                      <span className="w-28 truncate">{k}</span>
                      <Bar p={p} />
                      <span>{pct(p)}</span>
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={`Beam (separation ${trace.beam.separation.toFixed(2)})`}>
        <ol className="list-decimal pl-4">
          {trace.beam.candidates.map((c) => (
            <li key={c.leafId}>
              <code>{c.path.join(" › ") || c.leafId}</code> <Bar p={c.score} /> {pct(c.score)}
            </li>
          ))}
        </ol>
      </Section>
      <Section title="Policy">
        {trace.policy.length ? (
          <ul>
            {trace.policy.map((p, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: policy rows are static per trace
              <li key={i}>
                {p.decision.allowed ? "✓" : "✗"} <code>{p.subject}</code> — {p.decision.rule}:{" "}
                {p.decision.reason}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-500">No policy checks.</p>
        )}
        {trace.pruned.length ? (
          <ul className="mt-1 text-slate-600">
            {trace.pruned.map((p) => (
              <li key={p.leafId}>
                pruned <code>{p.leafId}</code>: {p.reason}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>
      <Section title="Diff">
        {trace.diff.length ? (
          <ul>
            {trace.diff.map((d) => (
              <li key={`${d.op}:${d.id}`}>
                {d.op} <code>{d.id}</code>
                {d.op === "update" ? ` (${d.changedProps.join(", ")})` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-500">No change.</p>
        )}
      </Section>
      <Section title="Timings and models">
        <p>
          total {trace.timings.totalMs} ms · decide {trace.timings.decideMs} ms · compose{" "}
          {trace.timings.composeMs} ms
        </p>
        <p>
          {trace.batches.length} batch{trace.batches.length === 1 ? "" : "es"} ·{" "}
          {models.join(", ") || "no provider calls"}
        </p>
      </Section>
    </div>
  );
}

/** Session metrics (SPEC §13.1) over everything in the sink. */
export function MetricsView({ traces, events }: { traces: DecisionTrace[]; events: TimedEvent[] }) {
  const m = summarize(traces, events);
  return (
    <Section title="Metrics">
      <dl className="grid grid-cols-2 gap-x-3" data-metrics>
        <dt>Decisions</dt>
        <dd>{m.traces}</dd>
        <dt>Override rate</dt>
        <dd>{pct(m.overrideRate)}</dd>
        <dt>Unwanted morphs</dt>
        <dd>{pct(m.unwantedMorphRate)}</dd>
        <dt>Clarify rate</dt>
        <dd>{pct(m.clarifyRate)}</dd>
        <dt>Fallback rate</dt>
        <dd>{pct(m.fallbackRate)}</dd>
        <dt>p50 / p95</dt>
        <dd>
          {Math.round(m.p50TotalMs)} / {Math.round(m.p95TotalMs)} ms
        </dd>
      </dl>
    </Section>
  );
}

/** "Why this?" affordance: opens the inspector focused on the component's decision path. */
export function MorphWhyThis({
  componentId,
  children,
}: {
  componentId: string;
  children: ReactNode;
}) {
  const { setInspectorOpen, setFocusComponent } = useMorphContext();
  return (
    <div className="group relative h-full">
      {children}
      <button
        type="button"
        data-why={componentId}
        onClick={() => {
          setFocusComponent(componentId);
          setInspectorOpen(true);
        }}
        className="absolute right-2 top-2 z-10 rounded-full bg-white/90 px-2 py-0.5 text-[11px] text-slate-500 opacity-0 shadow-sm ring-1 ring-slate-200 transition-opacity hover:text-indigo-700 focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
      >
        Why this?
      </button>
    </div>
  );
}
