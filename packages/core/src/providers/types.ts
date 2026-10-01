import type { JsonValue } from "../context/types";
import type { Answers } from "../decisions/answer";
import type { DecisionSpec } from "../decisions/spec";

export interface DecisionBatch {
  state: JsonValue;
  specs: DecisionSpec[];
  signal?: AbortSignal;
}

export interface DecisionProvider {
  readonly name: string;
  readonly calibrated: boolean;
  evaluate(batch: DecisionBatch): Promise<Answers>;
}

/** One attempt inside a provider chain, recorded in the trace. */
export interface ProviderAttempt {
  provider: string;
  model: string | null;
  latencyMs: number;
  ok: boolean;
  error?: string;
  inputTokens?: number;
  requestId?: string;
}

export interface EvaluationReport {
  answers: Answers;
  attempts: ProviderAttempt[];
}

/**
 * Optional extension: providers that wrap others (Composite, Remote, Replay) report every
 * attempt so the planner can record fallbacks in the trace (SPEC §7.3, I11).
 */
export interface ReportingProvider extends DecisionProvider {
  evaluateWithReport(batch: DecisionBatch): Promise<EvaluationReport>;
}

export function isReporting(p: DecisionProvider): p is ReportingProvider {
  return typeof (p as Partial<ReportingProvider>).evaluateWithReport === "function";
}

/** Evaluate any provider and return a report, synthesizing one attempt for plain providers. */
export async function evaluateReported(
  provider: DecisionProvider,
  batch: DecisionBatch,
  clock: () => number = Date.now,
): Promise<EvaluationReport> {
  if (isReporting(provider)) return provider.evaluateWithReport(batch);
  const start = clock();
  const answers = await provider.evaluate(batch);
  const first = Object.values(answers)[0];
  return {
    answers,
    attempts: [
      {
        provider: provider.name,
        model: first?.meta.model ?? null,
        latencyMs: clock() - start,
        ok: true,
      },
    ],
  };
}
