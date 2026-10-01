import type { Facts } from "morph-core";
import type { z } from "zod";
import type { SalesRowSchema } from "./parse";

export type SalesRow = z.infer<typeof SalesRowSchema>;

export interface SalesMonth {
  /** YYYY-MM */
  month: string;
  revenue: number;
  orders: number;
  profit: number;
  customers: number;
  /** Revenue z-score vs the trailing 6 months (0 while fewer than 6 precede it). */
  z: number;
  anomaly: boolean;
}

export interface SalesSegment {
  segment: string;
  revenueLast: number;
  revenuePrior: number;
  changePct: number;
  /** Share of the total revenue change, in percent. */
  contributionPct: number;
}

/** Per-customer numbers. Names are dataset strings and never appear here (I5). */
export interface SalesCustomer {
  id: string;
  segment: string;
  revenueLast: number;
  revenuePrior: number;
  change: number;
  changePct: number;
  daysSinceLastOrder: number;
  ordersLast: number;
  ordersPrior: number;
}

export interface SalesFacts extends Facts {
  sales: {
    /** Max order date in the data, YYYY-MM-DD. */
    asOf: string;
    /** The data stops before the end of its last month, so that month may be incomplete. */
    latestMonthPartial: boolean;
    /** Oldest → newest. */
    months: SalesMonth[];
    /** Biggest contribution to the change first. */
    segments: SalesSegment[];
    /** Biggest loss first. */
    customers: SalesCustomer[];
  };
}
