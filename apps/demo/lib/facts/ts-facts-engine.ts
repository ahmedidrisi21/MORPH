// Tier 0 facts engine for the demo dataset (SPEC §13.2). Plain TypeScript over parsed rows.
// Every number, bucket, ranking, date comparison and filter set is computed here (I3), and
// every Fact.text comes from a code template. Customer names never enter facts: they are
// dataset strings and go to ctx.untrusted via salesUntrusted() (I5).
import {
  bucketLabel,
  type DataCapability,
  type Fact,
  type Facts,
  type FactsEngine,
  type JsonValue,
  pctChangeBucket,
  shareBucket,
  zScoreBucket,
} from "@morph/core";
import type { SalesRow } from "./parse";

export const METRICS = ["revenue", "orders", "profit", "customer_count"] as const;
export type Metric = (typeof METRICS)[number];

export const FILTER_IDS = ["recoverable", "high_impact", "declining", "top_n"] as const;
export type FilterId = (typeof FILTER_IDS)[number];

export const TOP_N = 10;
export const RECOVERABLE_RECENCY_DAYS = 45;
/** Recoverable: last-3-month revenue at least 30% below the prior 3 months. */
export const RECOVERABLE_MAX_RATIO = 0.7;
export const ANOMALY_WINDOW_MONTHS = 6;
export const TOP_CONTRIBUTORS = 10;

export interface SalesFactsInput {
  rows: SalesRow[];
  datasetId?: string;
  /** End of the dataset (exclusive), YYYY-MM-DD. Defaults to the first day after the last month. */
  asOf?: string;
}

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
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

const round = (x: number, digits = 0): number => {
  const f = 10 ** digits;
  const r = Math.round(x * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

/** Percent change; 0 when both are 0, 100 when growing from 0. */
export function pctChange(prior: number, current: number): number {
  if (prior === 0) return current === 0 ? 0 : 100;
  return ((current - prior) / Math.abs(prior)) * 100;
}

const usd = (x: number): string => `$${Math.round(Math.abs(x)).toLocaleString("en-US")}`;
const count = (x: number): string => Math.round(x).toLocaleString("en-US");
const fmt = (m: Metric, x: number): string => (METRIC_UNIT[m] === "usd" ? usd(x) : count(x));
const pct = (x: number): string => `${Math.abs(round(x))}%`;
const monthLabel = (key: string): string => {
  const [y, m] = key.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
};
const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

function changeVerb(p: number): string {
  const b = pctChangeBucket(p);
  if (b === "flat") return "was flat";
  return `${p < 0 ? "fell" : "rose"} ${pct(p)}`;
}

function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

const dayMs = (date: string): number => Date.parse(`${date}T00:00:00Z`);

/** Stable ranking: by `score` ascending, ties by id. */
const rankBy = <T extends { id: string }>(xs: T[], score: (x: T) => number): T[] =>
  [...xs].sort((a, b) => score(a) - score(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

interface Totals {
  revenue: number;
  orders: number;
  profit: number;
  customers: Set<string>;
}
const emptyTotals = (): Totals => ({ revenue: 0, orders: 0, profit: 0, customers: new Set() });
const addRow = (t: Totals, r: SalesRow) => {
  t.revenue += r.revenue;
  t.orders += 1;
  t.profit += r.profit;
  t.customers.add(r.customerId);
};
const metricOf = (t: Totals, m: Metric): number =>
  m === "customer_count" ? t.customers.size : t[m];

interface CustomerStats {
  id: string;
  segment: string;
  last: number;
  prior: number;
  lastOrder: string;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/** Computes demo facts. Pure and deterministic for a given input. */
export function computeSalesFacts(input: SalesFactsInput): Facts {
  const { rows } = input;
  if (rows.length === 0) throw new Error("computeSalesFacts: no rows");

  const monthKeys = [...new Set(rows.map((r) => r.date.slice(0, 7)))].sort();
  const lastMonth = monthKeys.at(-1) as string;
  const asOf = input.asOf ?? `${addMonths(lastMonth, 1)}-01`;
  const lastWindow = new Set([0, 1, 2].map((i) => addMonths(lastMonth, -i)));
  const priorWindow = new Set([3, 4, 5].map((i) => addMonths(lastMonth, -i)));

  const byMonth = new Map<string, Totals>(monthKeys.map((k) => [k, emptyTotals()]));
  const last = emptyTotals();
  const prior = emptyTotals();
  const segLast = new Map<string, number>();
  const segPrior = new Map<string, number>();
  const customers = new Map<string, CustomerStats>();

  for (const r of rows) {
    const month = r.date.slice(0, 7);
    addRow(byMonth.get(month) as Totals, r);
    let c = customers.get(r.customerId);
    if (!c) {
      c = { id: r.customerId, segment: r.segment, last: 0, prior: 0, lastOrder: r.date };
      customers.set(r.customerId, c);
    }
    if (r.date > c.lastOrder) c.lastOrder = r.date;
    if (lastWindow.has(month)) {
      addRow(last, r);
      c.last += r.revenue;
      segLast.set(r.segment, (segLast.get(r.segment) ?? 0) + r.revenue);
    } else if (priorWindow.has(month)) {
      addRow(prior, r);
      c.prior += r.revenue;
      segPrior.set(r.segment, (segPrior.get(r.segment) ?? 0) + r.revenue);
    }
  }

  const items: Fact[] = [];

  // Totals and changes per metric -------------------------------------------------
  for (const m of METRICS) {
    const cur = metricOf(last, m);
    const prev = metricOf(prior, m);
    const change = pctChange(prev, cur);
    const bucket = pctChangeBucket(change);
    const L = METRIC_LABEL[m];
    items.push(
      {
        id: `${m}.total.last_3m`,
        label: `${L}, last 3 months`,
        value: round(cur),
        unit: METRIC_UNIT[m],
        text: `${L} in the last 3 months: ${fmt(m, cur)}.`,
      },
      {
        id: `${m}.total.prior_3m`,
        label: `${L}, prior 3 months`,
        value: round(prev),
        unit: METRIC_UNIT[m],
        text: `${L} in the prior 3 months: ${fmt(m, prev)}.`,
      },
      {
        id: `${m}.change_pct.last_3m`,
        label: `${L} change, last 3 months vs prior 3`,
        value: round(change, 1),
        unit: "pct",
        bucket,
        text: `${L} ${changeVerb(change)} vs the prior 3 months (${bucketLabel(bucket)}).`,
      },
    );
  }

  // Monthly series --------------------------------------------------------------
  for (const m of METRICS) {
    for (const key of monthKeys) {
      const v = metricOf(byMonth.get(key) as Totals, m);
      items.push({
        id: `${m}.month.${key}`,
        label: `${METRIC_LABEL[m]}, ${monthLabel(key)}`,
        value: round(v),
        unit: METRIC_UNIT[m],
        text: `${METRIC_LABEL[m]} in ${monthLabel(key)}: ${fmt(m, v)}.`,
      });
    }
  }

  // Segments --------------------------------------------------------------------
  const totalDelta = last.revenue - prior.revenue;
  const segments = [...new Set(rows.map((r) => r.segment))].sort();
  const segDeltas = segments.map((name) => {
    const cur = segLast.get(name) ?? 0;
    const prev = segPrior.get(name) ?? 0;
    return { id: slug(name), name, cur, prev, delta: cur - prev };
  });
  for (const s of segDeltas) {
    const change = pctChange(s.prev, s.cur);
    const bucket = pctChangeBucket(change);
    const share = totalDelta === 0 ? 0 : (s.delta / totalDelta) * 100;
    items.push(
      {
        id: `segment.${s.id}.revenue.last_3m`,
        label: `${s.name} revenue, last 3 months`,
        value: round(s.cur),
        unit: "usd",
        text: `${s.name} revenue in the last 3 months: ${usd(s.cur)}.`,
      },
      {
        id: `segment.${s.id}.revenue_change_usd.last_3m`,
        label: `${s.name} revenue change, last 3 months vs prior 3`,
        value: round(s.delta),
        unit: "usd",
        text: `${s.name} revenue ${s.delta < 0 ? "fell" : "rose"} ${usd(s.delta)} vs the prior 3 months.`,
      },
      {
        id: `segment.${s.id}.revenue_change_pct.last_3m`,
        label: `${s.name} revenue change %, last 3 months vs prior 3`,
        value: round(change, 1),
        unit: "pct",
        bucket,
        text: `${s.name} revenue ${changeVerb(change)} vs the prior 3 months (${bucketLabel(bucket)}).`,
      },
      {
        id: `segment.${s.id}.contribution_pct`,
        label: `${s.name} share of the total revenue change`,
        value: round(share, 1),
        unit: "pct",
        bucket: shareBucket(share),
        text: `${s.name} accounts for ${pct(share)} of the total revenue change (${bucketLabel(shareBucket(share))}).`,
      },
    );
  }
  // The segment that moved most in the direction of the total change.
  const top = rankBy(segDeltas, (s) => (totalDelta < 0 ? s.delta : -s.delta))[0];
  if (top && totalDelta !== 0) {
    const share = (top.delta / totalDelta) * 100;
    items.push({
      id: "segment.top_contributor",
      label: "Segment that contributed most to the revenue change",
      value: top.name,
      bucket: shareBucket(share),
      text: `${top.name} contributed most to the revenue ${totalDelta < 0 ? "decline" : "growth"} (${pct(share)} of the change).`,
    });
  }

  // Customers and filter sets ---------------------------------------------------
  const all = [...customers.values()];
  const asOfMs = dayMs(asOf);
  const recentSince = asOfMs - RECOVERABLE_RECENCY_DAYS * DAY_MS;
  const byDelta = rankBy(all, (c) => c.last - c.prior); // most negative first

  const recoverable = byDelta.filter(
    (c) =>
      c.prior > 0 && dayMs(c.lastOrder) >= recentSince && c.last <= c.prior * RECOVERABLE_MAX_RATIO,
  );
  const declining = byDelta.filter((c) => c.prior > 0 && pctChange(c.prior, c.last) <= -5);
  const highImpact = rankBy(
    all.filter((c) => c.last !== c.prior),
    (c) => -Math.abs(c.last - c.prior),
  ).slice(0, TOP_N);
  const topN = rankBy(all, (c) => -c.last).slice(0, TOP_N);
  const lapsed = all.filter((c) => c.prior > 0 && dayMs(c.lastOrder) < recentSince);

  const ids = (xs: CustomerStats[]) => xs.map((c) => c.id);
  const filters: Record<FilterId, string[]> = {
    recoverable: ids(recoverable),
    high_impact: ids(highImpact),
    declining: ids(declining),
    top_n: ids(topN),
  };

  const recoverableGap = recoverable.reduce((s, c) => s + (c.prior - c.last), 0);
  items.push(
    {
      id: "customers.recoverable.count",
      label: "Recoverable customers",
      value: recoverable.length,
      unit: "count",
      text: `${recoverable.length} customers ordered in the last ${RECOVERABLE_RECENCY_DAYS} days but spent at least 30% less than in the prior 3 months.`,
    },
    {
      id: "customers.recoverable.revenue_gap_usd",
      label: "Revenue gap of recoverable customers, last 3 months vs prior 3",
      value: round(recoverableGap),
      unit: "usd",
      text: `Recoverable customers spent ${usd(recoverableGap)} less than in the prior 3 months.`,
    },
    {
      id: "customers.lapsed.count",
      label: "Lapsed customers",
      value: lapsed.length,
      unit: "count",
      text: `${lapsed.length} customers who bought in the prior 3 months have not ordered in the last ${RECOVERABLE_RECENCY_DAYS} days.`,
    },
    {
      id: "customers.declining.count",
      label: "Declining customers",
      value: declining.length,
      unit: "count",
      text: `${declining.length} customers spent at least 5% less than in the prior 3 months.`,
    },
  );
  // Top contributing customers: largest moves in the direction of the total change.
  const contributors = (totalDelta < 0 ? byDelta : [...byDelta].reverse())
    .filter((c) => Math.sign(c.last - c.prior) === Math.sign(totalDelta))
    .slice(0, TOP_CONTRIBUTORS);
  contributors.forEach((c, i) => {
    const delta = c.last - c.prior;
    const change = pctChange(c.prior, c.last);
    items.push({
      id: `customer.${c.id}.revenue_change_usd.last_3m`,
      label: `Customer ${c.id} revenue change, last 3 months vs prior 3`,
      value: round(delta),
      unit: "usd",
      bucket: pctChangeBucket(change),
      text: `Customer ${c.id} (${c.segment}, #${i + 1} contributor) spent ${usd(delta)} ${delta < 0 ? "less" : "more"} than in the prior 3 months (${delta < 0 ? "-" : "+"}${pct(change)}).`,
    });
  });

  // Anomalies: monthly revenue z-score vs the trailing 6 months ------------------
  let anomalies = 0;
  monthKeys.forEach((key, i) => {
    if (i < ANOMALY_WINDOW_MONTHS) return;
    const window = monthKeys
      .slice(i - ANOMALY_WINDOW_MONTHS, i)
      .map((k) => (byMonth.get(k) as Totals).revenue);
    const mean = window.reduce((s, x) => s + x, 0) / window.length;
    const sd = Math.sqrt(window.reduce((s, x) => s + (x - mean) ** 2, 0) / window.length);
    if (sd === 0) return;
    const z = ((byMonth.get(key) as Totals).revenue - mean) / sd;
    const bucket = zScoreBucket(z);
    if (bucket === "normal") return;
    anomalies++;
    items.push({
      id: `revenue.anomaly.${key}`,
      label: `Revenue anomaly, ${monthLabel(key)}`,
      value: round(z, 1),
      bucket,
      text: `Revenue in ${monthLabel(key)} was unusually ${z < 0 ? "low" : "high"} compared with the 6 months before (${bucketLabel(bucket)}).`,
    });
  });
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

  // Capabilities ----------------------------------------------------------------
  const capabilities: DataCapability[] = [];
  if (monthKeys.length >= 2)
    capabilities.push({
      id: "has_time_series",
      description: `Monthly figures for ${monthKeys.length} months`,
    });
  if (monthKeys.length >= 6)
    capabilities.push({
      id: "has_two_periods",
      description: "Revenue for two comparable periods (last 3 months and the 3 before)",
    });
  if (segments.length >= 2)
    capabilities.push({
      id: "has_segments",
      description: `Revenue by customer segment (${segments.length} segments)`,
    });
  if (customers.size > 0)
    capabilities.push({ id: "has_customers", description: "Revenue by individual customer" });

  return { datasetId: input.datasetId ?? "sales", items, capabilities, filters };
}

/** `FactsEngine` over parsed sales rows. */
export const tsFactsEngine: FactsEngine<SalesFactsInput> = {
  compute: (input) => Promise.resolve(computeSalesFacts(input)),
};

/** Dataset strings for `ctx.untrusted` (I5): customer ID → name. Never read by policy or lenses. */
export function salesUntrusted(rows: SalesRow[]): Record<string, JsonValue> {
  const names: Record<string, JsonValue> = {};
  for (const r of rows) names[r.customerId] = r.customerName;
  return { customer_names: names };
}
