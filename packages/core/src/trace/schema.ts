import { z } from "zod";
import type { JsonValue } from "../context/types";
import type { DecisionTrace, TimedEvent } from "./types";

// Zod schemas for traces and events that cross a trust boundary: the browser posts them to the
// trace route, and `readTraceStore` reads them back for `calibrate`, `research` and `distill`.
// Everything is strict (unknown keys are rejected, so nothing but the expected fields is ever
// stored) and bounded (strings, arrays and records have caps). A trace is still self-reported by
// the client: this checks its shape and size, not that its contents are true.
//
// `pnpm test:golden` parses every golden trace through these, so a field added to DecisionTrace
// without being added here fails a test instead of silently rejecting real traces.

const id = z.string().min(1).max(200);
const label = z.string().max(100);
const text = (max: number) => z.string().max(max);
const prob = z.number().min(0).max(1);
const risk = z.enum(["low", "medium", "high", "critical"]);

const MAX_JSON_DEPTH = 8;
const MAX_JSON_NODES = 2_000;
const MAX_JSON_STRING = 2_000;

/** Lens content: any JSON, bounded in depth, node count and string length (checked iteratively). */
export function isBoundedJson(value: unknown): value is JsonValue {
  const stack: [unknown, number][] = [[value, 0]];
  let nodes = 0;
  while (stack.length) {
    const [v, depth] = stack.pop() as [unknown, number];
    if (++nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) return false;
    if (v === null || typeof v === "boolean") continue;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) return false;
    } else if (typeof v === "string") {
      if (v.length > MAX_JSON_STRING) return false;
    } else if (Array.isArray(v)) {
      for (const x of v) stack.push([x, depth + 1]);
    } else if (typeof v === "object") {
      for (const x of Object.values(v as Record<string, unknown>)) stack.push([x, depth + 1]);
    } else return false;
  }
  return true;
}

const boundedJson = z.custom<JsonValue>(isBoundedJson, "not bounded JSON");

/** A record with a cap on its number of keys. */
const record = <V extends z.ZodType>(key: z.ZodType<string>, value: V, maxKeys: number) =>
  z.record(key, value).refine((o) => Object.keys(o).length <= maxKeys, `at most ${maxKeys} keys`);

const AnswerMetaSchema = z.strictObject({
  provider: label,
  model: label.nullable(),
  calibrated: z.boolean(),
  latencyMs: z.number(),
  cached: z.boolean(),
});

const AnswerSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("choice"),
    value: label,
    probabilities: record(label, prob, 24),
    confidence: prob,
    meta: AnswerMetaSchema,
  }),
  z.strictObject({
    kind: z.literal("score"),
    expected: z.number(),
    probabilities: record(z.string().max(4), prob, 10),
    confidence: prob,
    meta: AnswerMetaSchema,
  }),
  z.strictObject({ kind: z.literal("noul"), p: prob, meta: AnswerMetaSchema }),
]);

const CandidateSchema = z.strictObject({
  leafId: id,
  path: z.array(id).max(12),
  score: z.number().min(0),
  edgeConfidences: z.array(prob).max(12),
});

const GateOutcomeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("auto"), target: CandidateSchema }),
  z.strictObject({ kind: z.literal("confirm"), target: CandidateSchema }),
  z.strictObject({
    kind: z.literal("alternates"),
    options: z.tuple([CandidateSchema, CandidateSchema]),
  }),
  z.strictObject({
    kind: z.literal("clarify"),
    options: z.array(CandidateSchema).max(10),
    filters: z.array(label).max(10).exactOptional(),
  }),
  z.strictObject({ kind: z.literal("refine"), filter: label }),
  z.strictObject({ kind: z.literal("stay"), reason: text(300) }),
]);

/** `Infinity` (the critical threshold) is `null` after JSON; it is read back as `Infinity`. */
const threshold = z
  .number()
  .nullable()
  .transform((n) => n ?? Number.POSITIVE_INFINITY);

const GateConfigSchema = z.strictObject({
  floor: z.number(),
  autoThreshold: z.strictObject({
    low: threshold,
    medium: threshold,
    high: threshold,
    critical: threshold,
  }),
  confirmBand: z.number(),
  minSeparation: z.number(),
  hysteresisMargin: z.number(),
  cooldownMs: z.number(),
  uncalibratedCap: z.number(),
  beamWidth: z.number(),
  fullTreeMaxNodes: z.number(),
});

const BatchLogEntrySchema = z.strictObject({
  provider: label,
  model: label.nullable(),
  specIds: z.array(label).max(64),
  latencyMs: z.number(),
  cached: z.array(label).max(64),
  error: text(1_000).exactOptional(),
  fallbackFrom: label.exactOptional(),
  inputTokens: z.number().exactOptional(),
  requestId: id.exactOptional(),
});

const UIDiffOpSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("add"), id, index: z.number().int() }),
  z.strictObject({ op: z.literal("remove"), id }),
  z.strictObject({ op: z.literal("move"), id, from: z.number().int(), to: z.number().int() }),
  z.strictObject({ op: z.literal("update"), id, changedProps: z.array(label).max(50) }),
]);

export const DecisionTraceSchema = z.strictObject({
  id,
  at: z.number(),
  trigger: z.enum(["intent", "data", "system"]),
  intent: text(2_000),
  lensStates: record(
    label,
    z.strictObject({
      hash: text(64),
      tokensEst: z.number(),
      content: boundedJson.exactOptional(),
    }),
    8,
  ),
  batches: z.array(BatchLogEntrySchema).max(20),
  answers: record(label, AnswerSchema, 64),
  pruned: z.array(z.strictObject({ leafId: id, reason: text(500) })).max(50),
  beam: z.strictObject({ candidates: z.array(CandidateSchema).max(50), separation: z.number() }),
  gate: z.strictObject({
    outcome: GateOutcomeSchema,
    reason: text(1_000),
    config: GateConfigSchema,
    risk: risk.exactOptional(),
    confidence: prob.exactOptional(),
  }),
  policy: z
    .array(
      z.strictObject({
        subject: text(400),
        decision: z.strictObject({ allowed: z.boolean(), rule: label, reason: text(500) }),
      }),
    )
    .max(200),
  diff: z.array(UIDiffOpSchema).max(200),
  narrative: z
    .array(
      z.strictObject({
        slotId: id,
        claimsIn: z.number(),
        claimsKept: z.number(),
        dropped: z.array(text(300)).max(20),
      }),
    )
    .max(50),
  timings: z.strictObject({
    factsMs: z.number(),
    decideMs: z.number(),
    resolveMs: z.number(),
    composeMs: z.number(),
    totalMs: z.number(),
  }),
  result: z.strictObject({ workspaceId: id, filter: label.nullable() }).exactOptional(),
  validation: z
    .array(z.strictObject({ componentId: id, error: text(1_000) }))
    .max(50)
    .exactOptional(),
  error: text(2_000).exactOptional(),
});

export const TimedEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("override"),
    traceId: id,
    from: id,
    to: id,
    via: z.enum(["alternate", "undo", "clarify"]),
    at: z.number(),
  }),
  z.strictObject({
    type: z.literal("confirm"),
    traceId: id,
    accepted: z.boolean(),
    at: z.number(),
  }),
  z.strictObject({ type: z.literal("task_complete"), traceId: id, task: id, at: z.number() }),
  z.strictObject({
    type: z.literal("render_error"),
    traceId: id,
    componentId: id,
    error: text(2_000),
    at: z.number(),
  }),
]);

export const MAX_TRACES_PER_BATCH = 50;
export const MAX_EVENTS_PER_BATCH = 200;

export const TraceBatchSchema = z.strictObject({
  version: z.literal(1),
  traces: z.array(DecisionTraceSchema).max(MAX_TRACES_PER_BATCH),
  events: z.array(TimedEventSchema).max(MAX_EVENTS_PER_BATCH),
});

// Compile-time check that the schemas and the types agree (a drift fails `pnpm typecheck`).
export type ParsedTrace = z.infer<typeof DecisionTraceSchema>;
export type ParsedEvent = z.infer<typeof TimedEventSchema>;
const _traceMatches = (t: ParsedTrace): DecisionTrace => t;
const _eventMatches = (e: ParsedEvent): TimedEvent => e;
void _traceMatches;
void _eventMatches;
