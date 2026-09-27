import { z } from "zod";
import type { LensId } from "../context/lens";
export declare const SPEC_ID_RE: RegExp;
export declare const LABEL_RE: RegExp;
export declare const ChoiceSpecSchema: z.ZodObject<{
    id: z.ZodString;
    instructions: z.ZodString;
    lens: z.ZodString;
    dependsOn: z.ZodOptional<z.ZodArray<z.ZodString>>;
    kind: z.ZodLiteral<"choice">;
    options: z.ZodRecord<z.ZodString, z.ZodString>;
}, z.core.$strip>;
export declare const ScoreSpecSchema: z.ZodObject<{
    id: z.ZodString;
    instructions: z.ZodString;
    lens: z.ZodString;
    dependsOn: z.ZodOptional<z.ZodArray<z.ZodString>>;
    kind: z.ZodLiteral<"score">;
    levels: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export declare const NoulSpecSchema: z.ZodObject<{
    id: z.ZodString;
    instructions: z.ZodString;
    lens: z.ZodString;
    dependsOn: z.ZodOptional<z.ZodArray<z.ZodString>>;
    kind: z.ZodLiteral<"noul">;
    criteria: z.ZodOptional<z.ZodObject<{
        true: z.ZodString;
        false: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const DecisionSpecSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    id: z.ZodString;
    instructions: z.ZodString;
    lens: z.ZodString;
    dependsOn: z.ZodOptional<z.ZodArray<z.ZodString>>;
    kind: z.ZodLiteral<"choice">;
    options: z.ZodRecord<z.ZodString, z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    id: z.ZodString;
    instructions: z.ZodString;
    lens: z.ZodString;
    dependsOn: z.ZodOptional<z.ZodArray<z.ZodString>>;
    kind: z.ZodLiteral<"score">;
    levels: z.ZodArray<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    id: z.ZodString;
    instructions: z.ZodString;
    lens: z.ZodString;
    dependsOn: z.ZodOptional<z.ZodArray<z.ZodString>>;
    kind: z.ZodLiteral<"noul">;
    criteria: z.ZodOptional<z.ZodObject<{
        true: z.ZodString;
        false: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>], "kind">;
interface SpecBase {
    id: string;
    instructions: string;
    lens: LensId;
    dependsOn?: string[];
}
export type DecisionSpec = (SpecBase & {
    kind: "choice";
    options: Record<string, string>;
}) | (SpecBase & {
    kind: "score";
    levels: [string, string, ...string[]];
}) | (SpecBase & {
    kind: "noul";
    criteria?: {
        true: string;
        false: string;
    };
});
export type ChoiceSpec = Extract<DecisionSpec, {
    kind: "choice";
}>;
export type ScoreSpec = Extract<DecisionSpec, {
    kind: "score";
}>;
export type NoulSpec = Extract<DecisionSpec, {
    kind: "noul";
}>;
export declare class SpecValidationError extends Error {
    readonly issues: string[];
    readonly name = "SpecValidationError";
    constructor(issues: string[]);
}
/** Validate a batch of specs: shape, unique IDs, dependsOn references, no cycles. */
export declare function validateSpecs(input: unknown[]): DecisionSpec[];
/** Option labels (choice) or level indices as strings (score). */
export declare function specKeys(spec: DecisionSpec): string[];
export {};
