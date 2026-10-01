import type { JsonValue, MorphContext } from "./types";

export type LensId = string;
export interface LensDeps {
  describeWorkspace(id: string): string;
}
export type Lens = (ctx: MorphContext, deps: LensDeps) => JsonValue;

export const LENS_TOKEN_BUDGET = 2000;

/** Token estimate used for lens budgets: ceil(JSON length / 4). */
export function estimateTokens(state: JsonValue): number {
  return Math.ceil(JSON.stringify(state).length / 4);
}

export class LensBudgetError extends Error {
  override readonly name = "LensBudgetError";
  constructor(
    readonly lensId: LensId,
    readonly tokens: number,
  ) {
    super(`Lens "${lensId}" produced ~${tokens} tokens (budget ${LENS_TOKEN_BUDGET}).`);
  }
}

/**
 * The MVP lens. It carries no numbers, rows, customer names, or permissions:
 * the model never needs them to decide which workspace fits (I3, I4, I5).
 */
export const coreLens: Lens = (ctx, { describeWorkspace }) => ({
  intent: ctx.intent.raw,
  previous_intents: ctx.intent.history.slice(-2),
  current_workspace: ctx.ui.workspaceId
    ? describeWorkspace(ctx.ui.workspaceId)
    : "none (start screen)",
  current_filter: ctx.ui.activeFilter ?? "none",
  available_data: ctx.facts.capabilities.map((c) => c.description),
  user_role: ctx.user.role,
});

export const defaultLenses: Record<LensId, Lens> = { core: coreLens };
