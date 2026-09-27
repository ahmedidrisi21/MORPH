import type { JsonValue } from "../context/types";
import type { Answers } from "../decisions/answer";
import type { DecisionSpec } from "../decisions/spec";
import type { DecisionBatch, DecisionProvider } from "./types";
/**
 * A rule maps lens state to a distribution:
 * - choice: weights per option label (missing labels get 0; all-zero → uniform)
 * - score: weights per level index
 * - noul: P(yes) in [0, 1]
 */
export type Rule = (state: JsonValue, spec: DecisionSpec) => Record<string, number> | number;
export interface RulesProviderOptions {
    rules: Record<string, Rule>;
    /** Weight added to every option so no probability is exactly zero. Default 0.02. */
    smoothing?: number;
    name?: string;
}
/** Deterministic keyword/regex rules per spec ID. Uncalibrated; works offline. */
export declare class RulesProvider implements DecisionProvider {
    #private;
    readonly name: string;
    readonly calibrated = false;
    constructor(opts: RulesProviderOptions);
    has(specId: string): boolean;
    evaluate(batch: DecisionBatch): Promise<Answers>;
    answer(spec: DecisionSpec, state: JsonValue): import("..").Answer;
}
/** Read a string field from lens state (empty string when absent). */
export declare function stateText(state: JsonValue, field: string): string;
export interface KeywordPattern {
    /** Label (choice) or level index as string (score). */
    label: string;
    pattern: RegExp;
    weight?: number;
}
/**
 * Build a rule that scores labels by regex matches against a state field (default `intent`).
 * `otherwise` receives the weight when nothing matches.
 */
export declare function keywordRule(patterns: KeywordPattern[], opts?: {
    field?: string;
    otherwise?: string;
    otherwiseWeight?: number;
}): Rule;
