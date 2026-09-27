import type { z } from "zod";
import type { RiskLevel } from "../context/types";
export interface CapabilityDef<P = unknown> {
    /** "kpi" | "chart" | "table" | "insight" | "action" | "alert" | "timeline" | "panel" | custom */
    type: string;
    description: string;
    props: z.ZodType<P>;
    risk: RiskLevel;
    permission?: string;
}
export interface ActionDef {
    id: string;
    label: string;
    risk: RiskLevel;
    permission?: string;
    capability: "action";
}
export type PropValidation = {
    ok: true;
    props: unknown;
} | {
    ok: false;
    error: string;
};
/** Renderer-less capability registry. `@morph/react` maps each type to a component. */
export declare class CapabilityRegistry {
    #private;
    constructor(capabilities: CapabilityDef[], actions?: ActionDef[]);
    get(type: string): CapabilityDef | undefined;
    types(): string[];
    capabilities(): CapabilityDef[];
    action(id: string): ActionDef | undefined;
    actions(): ActionDef[];
    actionIds(): string[];
    /** Zod-validate props for a capability type. Never throws. */
    validateProps(type: string, props: unknown): PropValidation;
}
export declare function createRegistry(capabilities: CapabilityDef[], actions?: ActionDef[]): CapabilityRegistry;
/**
 * Compare registered types with renderer types. Returns human-readable problems
 * (empty when every type has a renderer and every renderer has a type).
 */
export declare function registryCompleteness(registry: CapabilityRegistry, rendererTypes: string[]): string[];
