// Tier 0 facts engine for the demo dataset (SPEC §13.2). Plain TypeScript over parsed rows.
// Every number, bucket, ranking, date comparison and filter set is computed here (I3), and
// every Fact.text comes from a code template. Customer names never enter facts: they are
// dataset strings and go to ctx.untrusted via customerNames() (I5).
import {
  bucketLabel,
  type DataCapability,
  type Fact,
  type FactsEngine,
  pctChangeBucket,
  shareBucket,
  zScoreBucket,
} from "morph-core";
import type { SalesCustomer, SalesFacts, SalesMonth, SalesRow, SalesSegment } from "./types";

export const FILTER_IDS = ["recoverable", "high_impact", "declining", "top_n"] as const;
export type FilterId = (typeof FILTER_IDS)[number];

const METRICS = ["revenue", "orders", "profit", "customer_count"] as const;
type Metric = (typeof METRICS)[number];

const TOP_N = 10;
const RECENCY_DAYS = 45;
/** Recoverable: last-3-month revenue at least 30% below the prior 3 months. */
const RECOVERABLE_MAX_RATIO = 0.7;
const ANOMALY_WINDOW = 6;
const DAY_MS = 86_400_000;

const METRIC_LABEL: Record<Metric, string> = {
  revenue: "Revenue",
  orders: "Orders",
  profit: "Profit",
  customer_count: "Active customers",
};
const METRIC_UNIT: Record<Metric, "usd" | "count"> = {
  revenue: "usd",
  orders: "count",
  profit: "usd",
  customer_count: "count",
};
const MONTH_NAMES = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function round(x: number, digits = 0): number {
  const f = 10 ** digits;
  const r = Math.round(x * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/** Percent change; 0 when both are 0, 100 when growing from 0. */
function pctChange(prior: number, current: number): number {
  if (prior === 0) return current === 0 ? 0 : 100;
  return ((current - prior) / Math.abs(prior)) * 100;
}

const usd = (x: number) => `$${Math.round(Math.abs(x)).toLocaleString("en-US")}`;
const count = (x: number) => Math.round(x).toLocaleString("en-US");
const fmt = (m: Metric, x: number) => (METRIC_UNIT[m] === "usd" ? usd(x) : count(x));
const pct = (x: number) => `${Math.abs(round(x))}%`;
const snake = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

const dayMs = (date: string) => Date.parse(`${date}T00:00:00Z`);

function changeText(label: string, p: number): string {
  const b = pctChangeBucket(p);
  const verb = b === "flat" ? "was flat" : `${p < 0 ? "fell" : "rose"} ${pct(p)}`;
  return `${label} ${verb} vs the prior 3 months (${bucketLabel(b)}).`;
}

/** Stable ascending sort by `score`, ties by id. */
function rankBy<T extends { id: string }>(xs: T[], score: (x: T) => number): T[] {
  return [...xs].sort((a, b) => score(a) - score(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

interface Totals {
  revenue: number;
  orders: number;
  profit: number;
  customers: Set<string>;
}
const emptyTotals = (): Totals => ({ revenue: 0, orders: 0, profit: 0, customers: new Set() });
function add(t: Totals, r: SalesRow): void {
  t.revenue += r.revenue;
  t.orders += 1;
  t.profit += r.revenue - r.cost;
  t.customers.add(r.customerId);
}
const metricOf = (t: Totals, m: Metric) => (m === "customer_count" ? t.customers.size : t[m]);

interface Acc {
  id: string;
  segment: string;
  revenueLast: number;
  revenuePrior: number;
  ordersLast: number;
  ordersPrior: number;
  lastOrder: string;
}

/** Computes demo facts. Pure, synchronous and deterministic. */
export function computeSalesFacts(rows: SalesRow[], datasetId = "sales"): SalesFacts {
  if (rows.length === 0) throw new Error("computeSalesFacts: no rows");

  let asOf = rows[0]?.date as string;
  for (const r of rows) if (r.date > asOf) asOf = r.date;
  const monthKeys = [...new Set(rows.map((r) => r.date.slice(0, 7)))].sort();
  const lastMonth = monthKeys.at(-1) as string;
  const lastWindow = new Set([0, 1, 2].map((i) => addMonths(lastMonth, -i)));
  const priorWindow = new Set([3, 4, 5].map((i) => addMonths(lastMonth, -i)));

  const byMonth = new Map<string, Totals>(monthKeys.map((k) => [k, emptyTotals()]));
  const last = emptyTotals();
  const prior = emptyTotals();
  const segLast = new Map<string, number>();
  const segPrior = new Map<string, number>();
  const accs = new Map<string, Acc>();

  for (const r of rows) {
    const month = r.date.slice(0, 7);
    add(byMonth.get(month) as Totals, r);
    let c = accs.get(r.customerId);
    if (!c) {
      c = {
        id: r.customerId,
        segment: r.segment,
        revenueLast: 0,
        revenuePrior: 0,
        ordersLast: 0,
        ordersPrior: 0,
        lastOrder: r.date,
      };
      accs.set(r.customerId, c);
    }
    if (r.date > c.lastOrder) c.lastOrder = r.date;
    if (lastWindow.has(month)) {
      add(last, r);
      c.revenueLast += r.revenue;
      c.ordersLast += 1;
      segLast.set(r.segment, (segLast.get(r.segment) ?? 0) + r.revenue);
    } else if (priorWindow.has(month)) {
      add(prior, r);
      c.revenuePrior += r.revenue;
      c.ordersPrior += 1;
      segPrior.set(r.segment, (segPrior.get(r.segment) ?? 0) + r.revenue);
    }
  }

  // Months with a revenue z-score vs the trailing 6 ----------------------------
  const months: SalesMonth[] = monthKeys.map((key, i) => {
    const t = byMonth.get(key) as Totals;
    let z = 0;
    if (i >= ANOMALY_WINDOW) {
      const w = monthKeys
        .slice(i - ANOMALY_WINDOW, i)
        .map((k) => (byMonth.get(k) as Totals).revenue);
      const mean = w.reduce((s, x) => s + x, 0) / w.length;
      const sd = Math.sqrt(w.reduce((s, x) => s + (x - mean) ** 2, 0) / w.length);
      z = sd === 0 ? 0 : (t.revenue - mean) / sd;
    }
    return {
      month: key,
      revenue: round(t.revenue),
      orders: t.orders,
      profit: round(t.profit),
      customers: t.customers.size,
      z: round(z, 2),
      anomaly: zScoreBucket(z) !== "normal",
    };
  });

  // Segments ---------------------------------------------------------------------
  const totalDelta = last.revenue - prior.revenue;
  const segments: SalesSegment[] = [...new Set(rows.map((r) => r.segment))]
    .map((segment) => {
      const cur = segLast.get(segment) ?? 0;
      const prev = segPrior.get(segment) ?? 0;
      return {
        segment,
        revenueLast: round(cur),
        revenuePrior: round(prev),
        changePct: round(pctChange(prev, cur), 1),
        contributionPct: totalDelta === 0 ? 0 : round(((cur - prev) / totalDelta) * 100, 1),
      };
    })
    .sort((a, b) => b.contributionPct - a.contributionPct || (a.segment < b.segment ? -1 : 1));

  // Customers -------------------------------------------------------------------
  const asOfMs = dayMs(asOf);
  const customers: SalesCustomer[] = rankBy(
    [...accs.values()],
    (c) => c.revenueLast - c.revenuePrior,
  ).map((c) => ({
    id: c.id,
    segment: c.segment,
    revenueLast: round(c.revenueLast),
    revenuePrior: round(c.revenuePrior),
    change: round(c.revenueLast - c.revenuePrior),
    changePct: round(pctChange(c.revenuePrior, c.revenueLast), 1),
    daysSinceLastOrder: Math.round((asOfMs - dayMs(c.lastOrder)) / DAY_MS),
    ordersLast: c.ordersLast,
    ordersPrior: c.ordersPrior,
  }));
  const exact = new Map([...accs.values()].map((c) => [c.id, c]));
  const isRecent = (c: SalesCustomer) => c.daysSinceLastOrder <= RECENCY_DAYS;
  const recoverable = customers.filter((c) => {
    const a = exact.get(c.id) as Acc;
    return (
      a.revenuePrior > 0 && isRecent(c) && a.revenueLast <= a.revenuePrior * RECOVERABLE_MAX_RATIO
    );
  });
  const declining = customers.filter((c) => {
    const a = exact.get(c.id) as Acc;
    return a.revenueLast < a.revenuePrior;
  });
  const churned = customers.filter((c) => c.revenuePrior > 0 && !isRecent(c));
  const highImpact = declining.slice(0, TOP_N); // already sorted by biggest loss
  const topN = rankBy(customers, (c) => -(exact.get(c.id) as Acc).revenueLast).slice(0, TOP_N);
  const ids = (xs: SalesCustomer[]) => xs.map((c) => c.id);
  const filters: Record<FilterId, string[]> = {
    recoverable: ids(recoverable),
    high_impact: ids(highImpact),
    declining: ids(declining),
    top_n: ids(topN),
  };

  // Facts -----------------------------------------------------------------------
  const items: Fact[] = [];
  for (const m of METRICS) {
    const cur = metricOf(last, m);
    const prev = metricOf(prior, m);
    const change = pctChange(prev, cur);
    const L = METRIC_LABEL[m];
    items.push(
      {
        id: `${m}.last_3m`,
        label: `${L}, last 3 months`,
        value: round(cur),
        unit: METRIC_UNIT[m],
        text: `${L} in the last 3 months: ${fmt(m, cur)}.`,
      },
      {
        id: `${m}.prior_3m`,
        label: `${L}, prior 3 months`,
        value: round(prev),
        unit: METRIC_UNIT[m],
        text: `${L} in the prior 3 months: ${fmt(m, prev)}.`,
      },
      {
        id: `${m}.change_pct`,
        label: `${L} change, last 3 months vs prior 3`,
        value: round(change, 1),
        unit: "pct",
        bucket: pctChangeBucket(change),
        text: changeText(L, change),
      },
    );
  }

  const top = segments[0];
  if (top && totalDelta !== 0) {
    const direction = totalDelta < 0 ? "decline" : "growth";
    items.push(
      {
        id: "segment.top_contributor",
        label: "Segment that drove the revenue change",
        value: top.segment,
        text: `${top.segment} drove most of the revenue ${direction}.`,
      },
      {
        id: "segment.top_contributor.share_pct",
        label: "Top segment's share of the revenue change",
        value: top.contributionPct,
        unit: "pct",
        bucket: shareBucket(top.contributionPct),
        text: `${top.segment} accounts for ${pct(top.contributionPct)} of the revenue ${direction} (${bucketLabel(shareBucket(top.contributionPct))}).`,
      },
    );
  }
  for (const s of [...segments].sort((a, b) => (a.segment < b.segment ? -1 : 1))) {
    items.push({
      id: `segment.${snake(s.segment)}.change_pct`,
      label: `${s.segment} revenue change, last 3 months vs prior 3`,
      value: s.changePct,
      unit: "pct",
      bucket: pctChangeBucket(s.changePct),
      text: changeText(`${s.segment} revenue`, s.changePct),
    });
  }

  const topLoss = declining[0];
  items.push(
    {
      id: "customers.declining.count",
      label: "Customers spending less",
      value: declining.length,
      unit: "count",
      text: `${declining.length} customers spent less than in the prior 3 months.`,
    },
    {
      id: "customers.recoverable.count",
      label: "Recoverable customers",
      value: recoverable.length,
      unit: "count",
      text: `${recoverable.length} customers ordered in the last ${RECENCY_DAYS} days but spent at least 30% less than in the prior 3 months.`,
    },
    {
      id: "customers.churned.count",
      label: "Customers who stopped ordering",
      value: churned.length,
      unit: "count",
      text: `${churned.length} customers who bought in the prior 3 months have not ordered in the last ${RECENCY_DAYS} days.`,
    },
    {
      id: "customers.top_loss.change",
      label: "Biggest single-customer revenue loss",
      value: topLoss ? topLoss.change : 0,
      unit: "usd",
      text: topLoss
        ? `The biggest single-customer loss was ${usd(topLoss.change)} (${topLoss.segment}).`
        : "No customer spent less than in the prior 3 months.",
    },
  );

  const anomalies = months.filter((m) => m.anomaly).length;
  items.push({
    id: "revenue.anomaly.count",
    label: "Months with unusual revenue",
    value: anomalies,
    unit: "count",
    text:
      anomalies === 0
        ? "No month had unusual revenue compared with the 6 months before."
        : `${anomalies} ${anomalies === 1 ? "month" : "months"} had unusual revenue compared with the 6 months before.`,
  });
  const latest = months.at(-1) as SalesMonth;
  const before = months.at(-2);
  const latestChange = before ? pctChange(before.revenue, latest.revenue) : 0;
  const latestBucket = pctChangeBucket(latestChange);
  items.push({
    id: "revenue.latest_month.change_pct",
    label: "Revenue change, latest month vs the month before",
    value: round(latestChange, 1),
    unit: "pct",
    bucket: latestBucket,
    text: `Revenue in ${monthLabel(latest.month)} ${
      latestBucket === "flat"
        ? "was flat"
        : `${latestChange < 0 ? "fell" : "rose"} ${pct(latestChange)}`
    } vs the month before (${bucketLabel(latestBucket)}).`,
  });

  const capabilities: DataCapability[] = [];
  if (monthKeys.length >= 2)
    capabilities.push({ id: "has_time_series", description: "Monthly sales figures" });
  if (monthKeys.length >= 6)
    capabilities.push({
      id: "has_two_periods",
      description: "Revenue for two comparable periods",
    });
  if (segments.length >= 2)
    capabilities.push({ id: "has_segments", description: "Sales by customer segment" });
  capabilities.push({ id: "has_customers", description: "Sales by individual customer" });

  return {
    datasetId,
    items,
    capabilities,
    filters,
    sales: { asOf, months, segments, customers },
  };
}

/** `FactsEngine` over parsed rows, plus a synchronous variant for goldens and the browser. */
export const tsFactsEngine: FactsEngine<SalesRow[]> & {
  computeSync(rows: SalesRow[]): SalesFacts;
} = {
  compute: (rows) => Promise.resolve(computeSalesFacts(rows)),
  computeSync: (rows) => computeSalesFacts(rows),
};

/** Customer ID → name, for `ctx.untrusted` only (I5). Never read by policy or lenses. */
export function customerNames(rows: SalesRow[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const r of rows) names[r.customerId] = r.customerName;
  return names;
}
