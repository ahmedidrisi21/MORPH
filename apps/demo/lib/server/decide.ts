import {
  type Answers,
  type DecisionProvider,
  type DecisionSpec,
  errorMessage,
  evaluateReported,
  type JsonValue,
  type ProviderAttempt,
  SpecValidationError,
  validateSpecs,
} from "@morph/core";
import { z } from "zod";
import { clientIp, type RateLimiter } from "./rate-limit";

// POST /api/morph/decide (SPEC Appendix B). Validates everything, evaluates each batch on the
// server's provider chain, and never leaks stack traces.

export const MAX_BODY_BYTES = 32 * 1024;
export const MAX_SPECS_PER_BATCH = 40;
export const MAX_BATCHES = 8;

export type DecideErrorCode = "bad_request" | "rate_limited" | "provider_unavailable";

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

const BodySchema = z.object({
  batches: z
    .array(
      z.object({
        state: JsonValueSchema,
        specs: z.array(z.unknown()).min(1).max(MAX_SPECS_PER_BATCH),
      }),
    )
    .min(1)
    .max(MAX_BATCHES),
});

export interface DecideResponseBody {
  answers: Answers[];
  provider: string;
  model: string | null;
  fallbacks: string[];
  attempts: ProviderAttempt[];
}

export interface DecideHandlerOptions {
  provider: () => DecisionProvider;
  /** Returns null when the app knows the spec, else a reason (never trust client specs). */
  checkSpec: (spec: DecisionSpec) => string | null;
  limiter: RateLimiter;
  clock?: () => number;
  log?: (message: string) => void;
}

export function errorResponse(status: number, code: DecideErrorCode, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export function createDecideHandler(opts: DecideHandlerOptions) {
  const log = opts.log ?? ((m: string) => console.error(`[morph/decide] ${m}`));
  return async function decide(req: Request): Promise<Response> {
    if (!(await opts.limiter.take(clientIp(req.headers)))) {
      return errorResponse(429, "rate_limited", "Too many requests. Try again in a moment.");
    }
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES) return tooLarge();
    let text: string;
    try {
      text = await req.text();
    } catch {
      return errorResponse(400, "bad_request", "Could not read the request body.");
    }
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return tooLarge();

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return errorResponse(400, "bad_request", "The request body is not valid JSON.");
    }
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return errorResponse(
        400,
        "bad_request",
        `Expected { batches: [{ state, specs }] } with 1–${MAX_BATCHES} batches of 1–${MAX_SPECS_PER_BATCH} specs.`,
      );
    }

    const batches: { state: JsonValue; specs: DecisionSpec[] }[] = [];
    for (const b of parsed.data.batches) {
      let specs: DecisionSpec[];
      try {
        specs = validateSpecs(b.specs);
      } catch (err) {
        const detail = err instanceof SpecValidationError ? err.issues.slice(0, 3).join("; ") : "";
        return errorResponse(400, "bad_request", `Invalid decision specs. ${detail}`.trim());
      }
      const unknown = specs.map(opts.checkSpec).filter((r): r is string => r !== null);
      if (unknown.length) {
        return errorResponse(
          400,
          "bad_request",
          `Unknown specs: ${unknown.slice(0, 3).join("; ")}`,
        );
      }
      batches.push({ state: b.state, specs });
    }

    const provider = opts.provider();
    try {
      const reports = await Promise.all(
        batches.map((b) =>
          evaluateReported(provider, { ...b, signal: req.signal }, opts.clock ?? Date.now),
        ),
      );
      const attempts = reports.flatMap((r) => r.attempts);
      const winner = [...attempts].reverse().find((a) => a.ok);
      const body: DecideResponseBody = {
        answers: reports.map((r) => r.answers),
        provider: winner?.provider ?? provider.name,
        model: winner?.model ?? null,
        fallbacks: [...new Set(attempts.filter((a) => !a.ok).map((a) => a.provider))],
        attempts,
      };
      return Response.json(body);
    } catch (err) {
      log(errorMessage(err));
      return errorResponse(503, "provider_unavailable", "Decisions are unavailable right now.");
    }
  };
}

function tooLarge(): Response {
  return errorResponse(
    413,
    "bad_request",
    `The request body is larger than ${MAX_BODY_BYTES} bytes.`,
  );
}
