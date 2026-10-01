import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { TraceBatch } from "../trace/batching";
import { redactTrace } from "../trace/batching";
import { DecisionTraceSchema, TimedEventSchema } from "../trace/schema";
import type { DecisionTrace, TimedEvent } from "../trace/types";

const FILE = /^traces-\d{4}-\d{2}-\d{2}\.jsonl$/;

type Line = { kind: "trace"; trace: DecisionTrace } | { kind: "event"; event: TimedEvent };

export interface TraceStore {
  append(batch: TraceBatch): void;
}

/** The day's file is at its size limit; nothing more is stored until the next UTC day. */
export class TraceStoreFullError extends Error {
  override readonly name = "TraceStoreFullError";
  constructor(readonly limitBytes: number) {
    super(`The trace file for today is at its ${limitBytes} byte limit.`);
  }
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/**
 * Appends traces and events to one JSON Lines file per UTC day under `dir`
 * (`traces-YYYY-MM-DD.jsonl`). Lens-state content is dropped unless `keepLensContent` is set
 * (for the research loop). `maxBytesPerDay` caps one day's file: a batch that would pass it is
 * refused with `TraceStoreFullError`, so a flood cannot fill the disk. Server or CLI use only.
 */
export function jsonlTraceStore(
  dir: string,
  opts: { clock?: () => number; keepLensContent?: boolean; maxBytesPerDay?: number } = {},
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
      const file = join(dir, `traces-${day}.jsonl`);
      const payload = lines.map((l) => `${JSON.stringify(l)}\n`).join("");
      if (
        opts.maxBytesPerDay !== undefined &&
        fileSize(file) + Buffer.byteLength(payload) > opts.maxBytesPerDay
      ) {
        throw new TraceStoreFullError(opts.maxBytesPerDay);
      }
      appendFileSync(file, payload);
    },
  };
}

/**
 * Reads every `traces-*.jsonl` file in `dir`, oldest day first. A trace stored more than once
 * keeps its last version. Lines that are malformed, or whose trace or event does not match the
 * schema (a hand-edited file, or a client that posted something odd), are skipped and counted,
 * so the tools that fit thresholds and train models only see well-formed data.
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
      const trace = line.kind === "trace" ? DecisionTraceSchema.safeParse(line.trace) : null;
      const event = line.kind === "event" ? TimedEventSchema.safeParse(line.event) : null;
      if (trace?.success) {
        traces.delete(trace.data.id);
        traces.set(trace.data.id, trace.data);
      } else if (event?.success) {
        events.push(event.data);
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
