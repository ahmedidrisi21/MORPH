import type { DecisionTrace, MorphEvent, TimedEvent, TraceSink } from "./types";

export const DEFAULT_TRACE_CAPACITY = 200;

/**
 * In-memory ring buffer (200 traces by default) with JSON export. The Inspector reads it.
 * `forward` also receives every trace and event, for durable storage (see `batchingSink`).
 */
export class RingBufferSink implements TraceSink {
  readonly #traces: DecisionTrace[] = [];
  readonly #events: TimedEvent[] = [];
  readonly #capacity: number;
  readonly #clock: () => number;
  readonly #listeners = new Set<() => void>();
  readonly #forward: TraceSink | undefined;

  constructor(opts: { capacity?: number; clock?: () => number; forward?: TraceSink } = {}) {
    this.#capacity = opts.capacity ?? DEFAULT_TRACE_CAPACITY;
    this.#clock = opts.clock ?? Date.now;
    this.#forward = opts.forward;
  }

  write(t: DecisionTrace): void {
    const i = this.#traces.findIndex((x) => x.id === t.id);
    if (i >= 0) this.#traces[i] = t;
    else this.#traces.push(t);
    while (this.#traces.length > this.#capacity) this.#traces.shift();
    this.#forward?.write(t);
    this.#notify();
  }

  event(e: MorphEvent): void {
    this.#events.push({ ...e, at: this.#clock() });
    while (this.#events.length > this.#capacity * 5) this.#events.shift();
    this.#forward?.event(e);
    this.#notify();
  }

  traces(): DecisionTrace[] {
    return [...this.#traces];
  }

  events(): TimedEvent[] {
    return [...this.#events];
  }

  get(id: string): DecisionTrace | undefined {
    return this.#traces.find((t) => t.id === id);
  }

  latest(): DecisionTrace | undefined {
    return this.#traces[this.#traces.length - 1];
  }

  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  exportJSON(): string {
    return JSON.stringify({ version: 1, traces: this.#traces, events: this.#events }, null, 2);
  }

  #notify(): void {
    for (const fn of this.#listeners) fn();
  }
}

/** Fan out to several sinks. */
export function multiSink(...sinks: TraceSink[]): TraceSink {
  return {
    write: (t) => {
      for (const s of sinks) s.write(t);
    },
    event: (e) => {
      for (const s of sinks) s.event(e);
    },
  };
}
