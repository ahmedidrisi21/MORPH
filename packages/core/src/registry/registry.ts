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

export type PropValidation = { ok: true; props: unknown } | { ok: false; error: string };

/** Renderer-less capability registry. `morph-react` maps each type to a component. */
export class CapabilityRegistry {
  readonly #caps = new Map<string, CapabilityDef>();
  readonly #actions = new Map<string, ActionDef>();

  constructor(capabilities: CapabilityDef[], actions: ActionDef[] = []) {
    for (const c of capabilities) {
      if (this.#caps.has(c.type)) throw new Error(`Capability "${c.type}" registered twice.`);
      this.#caps.set(c.type, c);
    }
    for (const a of actions) {
      if (this.#actions.has(a.id)) throw new Error(`Action "${a.id}" registered twice.`);
      this.#actions.set(a.id, a);
    }
  }

  get(type: string): CapabilityDef | undefined {
    return this.#caps.get(type);
  }

  types(): string[] {
    return [...this.#caps.keys()];
  }

  capabilities(): CapabilityDef[] {
    return [...this.#caps.values()];
  }

  action(id: string): ActionDef | undefined {
    return this.#actions.get(id);
  }

  actions(): ActionDef[] {
    return [...this.#actions.values()];
  }

  actionIds(): string[] {
    return [...this.#actions.keys()];
  }

  /** Zod-validate props for a capability type. Never throws. */
  validateProps(type: string, props: unknown): PropValidation {
    const cap = this.#caps.get(type);
    if (!cap) return { ok: false, error: `Unknown capability type "${type}".` };
    const res = cap.props.safeParse(props);
    if (res.success) return { ok: true, props: res.data };
    const msg = res.error.issues
      .map((i) => `${i.path.join(".") || "(props)"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: msg };
  }
}

export function createRegistry(
  capabilities: CapabilityDef[],
  actions: ActionDef[] = [],
): CapabilityRegistry {
  return new CapabilityRegistry(capabilities, actions);
}

/**
 * Compare registered types with renderer types. Returns human-readable problems
 * (empty when every type has a renderer and every renderer has a type).
 */
export function registryCompleteness(
  registry: CapabilityRegistry,
  rendererTypes: string[],
): string[] {
  const problems: string[] = [];
  const renderers = new Set(rendererTypes);
  for (const t of registry.types())
    if (!renderers.has(t)) problems.push(`No renderer for capability "${t}".`);
  for (const t of renderers)
    if (!registry.get(t)) problems.push(`Renderer "${t}" has no registered capability.`);
  return problems;
}
