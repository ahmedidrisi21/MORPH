export interface Fact {
  /** e.g. "revenue.change_pct.last_3m" */
  id: string;
  label: string;
  value: number | string;
  unit?: "pct" | "usd" | "count" | "days";
  /** Computed in code, e.g. "large_decline". */
  bucket?: string;
  /** Code-generated sentence. */
  text: string;
}

export interface DataCapability {
  id: string;
  description: string;
}

export interface Facts {
  datasetId: string;
  items: Fact[];
  capabilities: DataCapability[];
  /** filterId → entity IDs that pass it. */
  filters: Record<string, string[]>;
}

export interface FactsEngine<Input = unknown> {
  compute(input: Input): Promise<Facts>;
}

export function getFact(facts: Facts, id: string): Fact | undefined {
  return facts.items.find((f) => f.id === id);
}

export function hasCapability(facts: Facts, id: string): boolean {
  return facts.capabilities.some((c) => c.id === id);
}
