import { composePolicies, defaultPolicy, type Policy } from "@morph/core";

/** Demo policy: the default permission check, plus critical actions are never offered to viewers. */
const viewerPolicy: Policy = {
  canRender: () => ({ allowed: true, rule: "viewer", reason: "Rendering is allowed." }),
  canAct: (action, ctx) =>
    ctx.user.role === "viewer" && action.risk !== "low"
      ? { allowed: false, rule: "viewer", reason: "Viewers can only run low-risk actions." }
      : { allowed: true, rule: "viewer", reason: "Allowed." },
};

export const demoPolicy: Policy = composePolicies(defaultPolicy, viewerPolicy);

export const DEMO_USER = {
  id: "demo",
  role: "sales_manager",
  permissions: ["read:sales", "read:customers"],
};
