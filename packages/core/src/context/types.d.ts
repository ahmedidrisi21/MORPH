import type { Facts } from "../facts/types";
export type JsonValue = string | number | boolean | null | JsonValue[] | {
    [k: string]: JsonValue;
};
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type Trigger = "intent" | "data" | "system";
export interface MorphContext {
    /** history: previous intents, oldest → newest, max 5 */
    intent: {
        raw: string;
        history: string[];
    };
    user: {
        id?: string;
        role: string;
        permissions: string[];
        preferences?: Record<string, string>;
    };
    ui: {
        workspaceId: string | null;
        componentIds: string[];
        lastMorphAt: number | null;
        activeFilter: string | null;
        viewport?: {
            width: number;
            height: number;
        };
    };
    facts: Facts;
    /** Dataset strings. Never read by policy and never placed in a lens (I5). */
    untrusted?: Record<string, JsonValue>;
    /** Injected clock (ms) for determinism. */
    now: number;
}
export declare const RISK_ORDER: Record<RiskLevel, number>;
export declare function maxRisk(levels: Iterable<RiskLevel>): RiskLevel;
export declare const INTENT_HISTORY_MAX = 5;
/** Append an intent to a history list, keeping the most recent five. */
export declare function pushHistory(history: string[], intent: string): string[];
