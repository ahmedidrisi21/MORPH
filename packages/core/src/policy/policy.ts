import type { MorphContext } from "../context/types";
import type { ActionDef, CapabilityDef } from "../registry/registry";

export interface PolicyDecision {
  allowed: boolean;
  rule: string;
  reason: string;
}

/** Deterministic code. Never reads ctx.untrusted and never calls a provider (I5, I6). */
export interface Policy {
  canRender(cap: CapabilityDef, ctx: MorphContext): PolicyDecision;
  canAct(action: ActionDef, ctx: MorphContext): PolicyDecision;
}

function permissionCheck(
  subject: { permission?: string },
  ctx: MorphContext,
  what: string,
): PolicyDecision {
  if (subject.permission && !ctx.user.permissions.includes(subject.permission)) {
    return {
      allowed: false,
      rule: "permission",
      reason: `${what} requires "${subject.permission}", which role "${ctx.user.role}" does not have.`,
    };
  }
  return { allowed: true, rule: "permission", reason: `${what} is permitted.` };
}

export const defaultPolicy: Policy = {
  canRender: (cap, ctx) => permissionCheck(cap, ctx, `Capability "${cap.type}"`),
  canAct: (action, ctx) => permissionCheck(action, ctx, `Action "${action.id}"`),
};

/** Critical-risk actions never auto-execute and always need explicit confirmation. */
export function requiresConfirmation(action: ActionDef): boolean {
  return action.risk === "critical";
}

/** All policies must allow; the first denial wins. */
export function composePolicies(...policies: Policy[]): Policy {
  const first = (decisions: PolicyDecision[]): PolicyDecision =>
    decisions.find((d) => !d.allowed) ??
    decisions[decisions.length - 1] ?? { allowed: true, rule: "none", reason: "No policy." };
  return {
    canRender: (cap, ctx) => first(policies.map((p) => p.canRender(cap, ctx))),
    canAct: (action, ctx) => first(policies.map((p) => p.canAct(action, ctx))),
  };
}
