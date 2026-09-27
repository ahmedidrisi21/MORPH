import type { FetchLike } from "../providers/remote";
import type { DecisionTrace, MorphEvent, TimedEvent, TraceSink } from "./types";

/** What a trace store receives: traces and timed events since the last flush. */
export interface TraceBatch {
  version: 1;
  traces: DecisionTrace[];
  events: TimedEvent[];
}

export interface BatchingSinkOptions {
  /** Delivers a batch. A rejection is reported to `onError` and the batch is dropped. */
  send(batch: TraceBatch): Promise<void> | void;
  /** Flush as soon as this many traces plus events are pending (default 20). */
  maxBatch?: number;
  /** Flush this long after the first pending item (default 5000 ms). */
  delayMs?: number;
  clock?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onError?: (err: unknown) => void;
}

export interface BatchingSink extends TraceSink {
  /** Sends everything pending now. Resolves when that send settles. */
  flush(): Promise<void>;
  pending(): number;
}

/**
 * Drops lens-state content from a trace. Stored traces keep hashes and token estimates only,
 * even when the dev `traceFull` option put content in the in-memory copy (I4).
 */
export function redactTrace(t: DecisionTrace): DecisionTrace {
  const lensStates: DecisionTrace["lensStates"] = {};
  for (const [id, s] of Object.entries(t.lensStates)) {
    lensStates[id] = { hash: s.hash, tokensEst: s.tokensEst };
  }
  return { ...t, lensStates };
}

/**
 * A `TraceSink` that buffers traces and events and hands them to `send` in batches, for
 * durable storage. A trace written twice before a flush (for example, after a confirm) is sent
 * once, in its latest form. Never throws into the runtime.
 */
export function batchingSink(opts: BatchingSinkOptions): BatchingSink {
  const maxBatch = opts.maxBatch ?? 20;
  const delayMs = opts.delayMs ?? 5000;
  const clock = opts.clock ?? Date.now;
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer =
    opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const onError = opts.onError ?? (() => {});

  let traces = new Map<string, DecisionTrace>();
  let events: TimedEvent[] = [];
  let timer: unknown = null;

  const size = () => traces.size + events.length;

  function flush(): Promise<void> {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (size() === 0) return Promise.resolve();
    const batch: TraceBatch = { version: 1, traces: [...traces.values()], events };
    traces = new Map();
    events = [];
    try {
      return Promise.resolve(opts.send(batch)).catch(onError);
    } catch (err) {
      onError(err);
      return Promise.resolve();
    }
  }

  function added(): void {
    if (size() >= maxBatch) void flush();
    else if (timer === null) timer = setTimer(() => void flush(), delayMs);
  }

  return {
    write(t: DecisionTrace) {
      traces.delete(t.id);
      traces.set(t.id, redactTrace(t));
      added();
    },
    event(e: MorphEvent) {
      events.push({ ...e, at: clock() });
      added();
    },
    flush,
    pending: size,
  };
}

/** `send` for `batchingSink` that POSTs each batch as JSON to `url`. */
export function httpTraceSend(
  url: string,
  fetchImpl?: FetchLike,
): (batch: TraceBatch) => Promise<void> {
  const g = (globalThis as { fetch?: FetchLike }).fetch;
  const f = fetchImpl ?? g?.bind(globalThis);
  if (!f) throw new Error("httpTraceSend needs fetchImpl when global fetch is unavailable.");
  return async (batch) => {
    const res = await f(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(batch),
    });
    if (!res.ok) throw new Error(`Trace upload failed (${res.status}).`);
  };
}
