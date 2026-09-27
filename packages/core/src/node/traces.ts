import { appendFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TraceBatch } from "../trace/batching";
import { redactTrace } from "../trace/batching";
import type { DecisionTrace, TimedEvent } from "../trace/types";

const FILE = /^traces-\d{4}-\d{2}-\d{2}\.jsonl$/;

type Line = { kind: "trace"; trace: DecisionTrace } | { kind: "event"; event: TimedEvent };

export interface TraceStore {
  append(batch: TraceBatch): void;
}

/**
 * Appends traces and events to one JSON Lines file per UTC day under `dir`
 * (`traces-YYYY-MM-DD.jsonl`). Lens-state content is dropped unless `keepLensContent` is set
 * (for the research loop). Server or CLI use only.
 */
export function jsonlTraceStore(
  dir: string,
  opts: { clock?: () => number; keepLensContent?: boolean } = {},
): TraceStore {
  const clock = opts.clock ?? Date.now;
  return {
    append(batch) {
      const lines: Line[] = [
        ...batch.traces.map(
          (t): Line => ({ kind: "trace", trace: opts.keepLensContent ? t : redactTrace(t) }),
        ),
        ...batch.events.map((e): Line => ({ kind: "event", event: e })),
      ];
      if (lines.length === 0) return;
      mkdirSync(dir, { recursive: true });
      const day = new Date(clock()).toISOString().slice(0, 10);
      appendFileSync(
        join(dir, `traces-${day}.jsonl`),
        lines.map((l) => `${JSON.stringify(l)}\n`).join(""),
      );
    },
  };
}

/**
 * Reads every `traces-*.jsonl` file in `dir`, oldest day first. A trace stored more than once
 * keeps its last version. Malformed lines are skipped and counted.
 */
export function readTraceStore(dir: string): {
  traces: DecisionTrace[];
  events: TimedEvent[];
  skipped: number;
} {
  let files: string[] = [];
  try {
    files = readdirSync(dir)
      .filter((f) => FILE.test(f))
      .sort();
  } catch {
    return { traces: [], events: [], skipped: 0 };
  }
  const traces = new Map<string, DecisionTrace>();
  const events: TimedEvent[] = [];
  let skipped = 0;
  for (const f of files) {
    for (const raw of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (raw.trim() === "") continue;
      let line: Partial<Line> & { trace?: DecisionTrace; event?: TimedEvent };
      try {
        line = JSON.parse(raw) as typeof line;
      } catch {
        skipped += 1;
        continue;
      }
      if (line.kind === "trace" && typeof line.trace?.id === "string") {
        traces.delete(line.trace.id);
        traces.set(line.trace.id, line.trace);
      } else if (line.kind === "event" && typeof line.event?.type === "string") {
        events.push(line.event);
      } else {
        skipped += 1;
      }
    }
  }
  return {
    traces: [...traces.values()].sort((a, b) => a.at - b.at),
    events: events.sort((a, b) => a.at - b.at),
    skipped,
  };
}
