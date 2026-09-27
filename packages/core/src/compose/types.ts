import type { MorphContext } from "../context/types";
import type { Answers } from "../decisions/answer";
import type { Facts } from "../facts/types";

export type Slot = "header" | "main" | "side" | "footer";
export type Layout = "overview" | "investigation" | "comparison" | "customers" | "action";
export type Density = 0 | 1 | 2;

export interface ComponentInstance {
  /** Stable & deterministic: `${leafId}:${type}:${key}` — enables diffing. */
  id: string;
  type: string;
  /** Validated against the registry schema before render. */
  props: unknown;
  slot: Slot;
  /** Lower renders first within a slot. */
  priority: number;
  /** Tier 2 fills this. */
  narrativeSlot?: { slotId: string; factIds: string[] };
}

export interface TemplateInput {
  facts: Facts;
  answers: Answers;
  ctx: MorphContext;
  density: Density;
  filter: string | null;
}

export interface WorkspaceTemplate {
  leafId: string;
  title(facts: Facts, answers: Answers): string;
  layout: Layout;
  /** DataCapability IDs. */
  requiresData: string[];
  /** Component IDs that must survive policy. */
  required: string[];
  supportsFilters: string[];
  build(input: TemplateInput): ComponentInstance[];
}

export interface PendingOption {
  leafId: string;
  title: string;
}

export interface MorphUIState {
  version: 1;
  workspaceId: string;
  title: string;
  layout: Layout;
  density: Density;
  filter: string | null;
  components: ComponentInstance[];
  /** Max 2. */
  alternates: { leafId: string; title: string; score: number }[];
  pending: null | {
    kind: "confirm" | "clarify" | "alternates";
    options: PendingOption[];
    /** Clarify only: filters the current workspace supports. */
    filters?: string[];
  };
  traceId: string;
}
