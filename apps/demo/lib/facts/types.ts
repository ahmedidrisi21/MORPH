import type { Facts } from "@morph/core";

export interface SalesRow {
  order_id: string;
  date: string;
  customer_id: string;
  customer_name: string;
  segment: string;
  revenue: number;
  cost: number;
}

export interface MonthPoint {
  month: string;
  revenue: number;
  orders: number;
  profit: number;
  customers: number;
  z: number;
  anomaly: boolean;
}

export interface SegmentDelta {
  segment: string;
  revenueLast: number;
  revenuePrior: number;
  changePct: number;
  contributionPct: number;
}

export interface CustomerDelta {
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

/** Facts plus precomputed series for charts and tables. Every number is computed in code (I3). */
export interface SalesFacts extends Facts {
  sales: {
    asOf: string;
    months: MonthPoint[];
    segments: SegmentDelta[];
    customers: CustomerDelta[];
  };
}
