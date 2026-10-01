import {
  type Answers,
  type ComponentInstance,
  choiceAnswer,
  type Fact,
  type Facts,
  getFact,
  type MorphContext,
  noulAnswer,
  type TemplateInput,
  type WorkspaceTemplate,
} from "morph-core";
import type { SalesCustomer, SalesFacts } from "../facts/types";
import { fmtInt, fmtMonth, fmtPct, fmtUsd, fmtUsdCompact } from "./format";
import { MAX_CHART_HIGHLIGHTS, MAX_CHART_POINTS } from "./registry";

// Deterministic templates (SPEC §11.2). Pure: facts + answers → components.
// Numbers come from the facts engine; templates only pick and format them.

type Metric = "revenue" | "orders" | "profit" | "customer_count";
const METRICS: Metric[] = ["revenue", "orders", "profit", "customer_count"];
const METRIC_LABEL: Record<Metric, string> = {
  revenue: "Revenue (last 3 months)",
  orders: "Orders (last 3 months)",
  profit: "Profit (last 3 months)",
  customer_count: "Active customers",
};
export const FILTER_LABEL: Record<string, string> = {
  recoverable: "customers you can still win back",
  high_impact: "biggest revenue impact",
  declining: "declining customers",
  top_n: "top 10",
};

const sales = (facts: Facts) =>
  (facts as SalesFacts).sales ?? { asOf: "", months: [], segments: [], customers: [] };

function focus(answers: Answers): Metric {
  const a = choiceAnswer(answers, "focus_metric");
  return a && (METRICS as string[]).includes(a.value) ? (a.value as Metric) : "revenue";
}

function orderedMetrics(answers: Answers): Metric[] {
  const f = focus(answers);
  return [f, ...METRICS.filter((m) => m !== f)];
}

function num(f: Fact | undefined): number {
  return typeof f?.value === "number" ? f.value : 0;
}

function kpi(leafId: string, facts: Facts, metric: Metric, priority: number): ComponentInstance {
  const total = getFact(facts, `${metric}.last_3m`);
  const change = getFact(facts, `${metric}.change_pct`);
  const value =
    metric === "revenue" || metric === "profit" ? fmtUsdCompact(num(total)) : fmtInt(num(total));
  const pct = num(change);
  const props: Record<string, unknown> = {
    label: METRIC_LABEL[metric],
    value,
    tone: pct <= -1 ? "down" : pct >= 1 ? "up" : "flat",
    delta: `${fmtPct(pct)} vs prior 3 months`,
  };
  if (total) props.factId = total.id;
  return { id: `${leafId}:kpi:${metric}`, type: "kpi", props, slot: "header", priority };
}

function kpis(leafId: string, facts: Facts, answers: Answers, count: number): ComponentInstance[] {
  return orderedMetrics(answers)
    .slice(0, count)
    .map((m, i) => kpi(leafId, facts, m, i));
}

function trendChart(
  leafId: string,
  facts: Facts,
  answers: Answers,
  priority: number,
): ComponentInstance {
  const s = sales(facts);
  const metric = focus(answers) === "customer_count" ? "customers" : focus(answers);
  // Long histories show the most recent months, so the chart always fits its props schema.
  const shown = s.months.slice(-MAX_CHART_POINTS);
  const truncated = shown.length < s.months.length;
  // The last 3 months first, then anomalies newest first, so a cap drops the oldest ones.
  const highlight = [
    ...new Set(
      [...shown.slice(-3), ...shown.filter((m) => m.anomaly).reverse()].map((m) =>
        fmtMonth(m.month),
      ),
    ),
  ].slice(0, MAX_CHART_HIGHLIGHTS);
  return {
    id: `${leafId}:chart:trend`,
    type: "chart",
    slot: "main",
    priority,
    props: {
      title: `Monthly ${metric === "customers" ? "active customers" : metric}`,
      kind: "bar",
      xKey: "month",
      series: [{ key: "value", label: metric }],
      data: shown.map((m) => ({
        month: fmtMonth(m.month),
        value: m[metric as "revenue" | "orders" | "profit" | "customers"],
      })),
      highlight,
      caption: `${truncated ? `Showing the last ${shown.length} months. ` : ""}Highlighted: the last 3 months and any anomalies.`,
    },
  };
}

function insight(
  leafId: string,
  key: string,
  title: string,
  facts: Facts,
  factIds: string[],
  priority: number,
  slot: ComponentInstance["slot"] = "side",
): ComponentInstance {
  const present = factIds.map((id) => getFact(facts, id)).filter((f): f is Fact => Boolean(f));
  const fallback = present.length
    ? present.map((f) => ({ text: f.text, factId: f.id }))
    : [{ text: "No facts are available for this view yet.", factId: "none" }];
  return {
    id: `${leafId}:insight:${key}`,
    type: "insight",
    slot,
    priority,
    props: { title, fallback },
    narrativeSlot: { slotId: `${leafId}:${key}`, factIds: present.map((f) => f.id) },
  };
}

function customerRows(
  ctx: MorphContext,
  facts: Facts,
  filter: string | null,
  limit: number,
): { rows: SalesCustomer[]; caption: string } {
  const s = sales(facts);
  const allowed = filter ? new Set(facts.filters[filter] ?? []) : null;
  let rows = s.customers;
  if (allowed) rows = rows.filter((c) => allowed.has(c.id));
  else rows = rows.filter((c) => c.change < 0);
  const caption = filter
    ? `Filtered to ${FILTER_LABEL[filter] ?? filter}: ${rows.length} customers.`
    : `${rows.length} customers bought less than in the prior 3 months.`;
  void ctx;
  return { rows: rows.slice(0, limit), caption };
}

function names(ctx: MorphContext): Record<string, string> {
  // Customer names are dataset strings: they live under `untrusted` and are shown as plain text only (I5).
  const n = ctx.untrusted?.customerNames;
  return n && typeof n === "object" && !Array.isArray(n) ? (n as Record<string, string>) : {};
}

function customerTable(
  leafId: string,
  key: string,
  title: string,
  input: TemplateInput,
  limit: number,
  priority: number,
): ComponentInstance {
  const { rows, caption } = customerRows(input.ctx, input.facts, input.filter, limit);
  const nm = names(input.ctx);
  return {
    id: `${leafId}:table:${key}`,
    type: "table",
    slot: "main",
    priority,
    props: {
      title,
      columns: [
        { key: "name", label: "Customer" },
        { key: "segment", label: "Segment" },
        { key: "last", label: "Last 3 mo", align: "right" },
        { key: "change", label: "Change", align: "right" },
        { key: "days", label: "Days since order", align: "right" },
      ],
      rows: rows.map((c) => ({
        id: c.id,
        cells: {
          name: nm[c.id] ?? c.id,
          segment: c.segment,
          last: fmtUsd(c.revenueLast),
          change: fmtPct(c.changePct),
          days: c.daysSinceLastOrder,
        },
      })),
      caption,
      emptyText: "No customers match.",
    },
  };
}

function segmentChart(
  leafId: string,
  facts: Facts,
  priority: number,
  filter: string | null,
): ComponentInstance {
  let segs = sales(facts).segments;
  if (filter === "declining") segs = segs.filter((s) => s.changePct < 0);
  if (filter === "high_impact" || filter === "top_n") segs = segs.slice(0, 3);
  return {
    id: `${leafId}:chart:segments`,
    type: "chart",
    slot: "main",
    priority,
    props: {
      title: "Revenue by segment: last 3 months vs prior 3",
      kind: "bar",
      xKey: "segment",
      series: [
        { key: "prior", label: "Prior 3 months" },
        { key: "last", label: "Last 3 months" },
      ],
      data: segs.map((s) => ({ segment: s.segment, prior: s.revenuePrior, last: s.revenueLast })),
    },
  };
}

function segmentTable(leafId: string, facts: Facts, priority: number): ComponentInstance {
  return {
    id: `${leafId}:table:segments`,
    type: "table",
    slot: "main",
    priority,
    props: {
      title: "Segments ranked by contribution to the change",
      columns: [
        { key: "segment", label: "Segment" },
        { key: "last", label: "Last 3 mo", align: "right" },
        { key: "change", label: "Change", align: "right" },
        { key: "share", label: "Share of change", align: "right" },
      ],
      rows: sales(facts).segments.map((s) => ({
        id: s.segment,
        cells: {
          segment: s.segment,
          last: fmtUsd(s.revenueLast),
          change: fmtPct(s.changePct),
          share: `${s.contributionPct.toFixed(1)}%`,
        },
      })),
    },
  };
}

function periodChart(leafId: string, facts: Facts, priority: number): ComponentInstance {
  const months = sales(facts).months;
  const last = months.slice(-3);
  const prior = months.slice(-6, -3);
  return {
    id: `${leafId}:chart:periods`,
    type: "chart",
    slot: "main",
    priority,
    props: {
      title: "Last 3 months vs the 3 months before, month by month",
      kind: "bar",
      xKey: "slot",
      series: [
        { key: "prior", label: "Prior 3 months" },
        { key: "last", label: "Last 3 months" },
      ],
      data: last.map((m, i) => ({
        slot: `Month ${i + 1}`,
        last: m.revenue,
        prior: prior[i]?.revenue ?? 0,
      })),
    },
  };
}

function actionPanel(leafId: string, priority: number): ComponentInstance {
  return {
    id: `${leafId}:action:next`,
    type: "action",
    slot: "side",
    priority,
    props: {
      title: "Recommended actions",
      actions: [
        {
          actionId: "schedule_calls",
          label: "Schedule account reviews",
          description: "Book a call with each recoverable customer this week.",
        },
        {
          actionId: "email_customers",
          label: "Email these customers",
          description: "Send a check-in from their account manager.",
        },
        {
          actionId: "export_list",
          label: "Export the list",
          description: "Download the customers as a CSV for your CRM.",
        },
        {
          actionId: "offer_discount",
          label: "Offer a win-back discount",
          description: "Needs explicit confirmation before anything is sent.",
        },
      ],
    },
  };
}

const INVESTIGATION_FACTS = [
  "revenue.change_pct",
  "segment.top_contributor",
  "segment.top_contributor.share_pct",
  "customers.declining.count",
];
const CUSTOMER_FACTS = [
  "customers.declining.count",
  "customers.recoverable.count",
  "customers.churned.count",
  "customers.top_loss.change",
];
const CUSTOMER_FILTERS = ["recoverable", "high_impact", "declining", "top_n"];

const titleFor = (base: string) => (facts: Facts) => {
  const top = getFact(facts, "segment.top_contributor");
  return base.replace("{segment}", typeof top?.value === "string" ? top.value : "one segment");
};

export const templates: WorkspaceTemplate[] = [
  {
    leafId: "overview.default",
    title: () => "Sales overview",
    layout: "overview",
    requiresData: ["has_time_series"],
    required: ["overview.default:kpi:revenue"],
    supportsFilters: [],
    build: ({ facts, answers, density }) => {
      const out = [
        ...kpis("overview.default", facts, answers, 4),
        trendChart("overview.default", facts, answers, 0),
      ];
      if (density >= 1)
        out.push(
          insight(
            "overview.default",
            "summary",
            "Summary",
            facts,
            ["revenue.change_pct", "orders.change_pct", "revenue.anomaly.count"],
            0,
          ),
        );
      // Denied for sales managers; proves per-component policy (SPEC §10).
      out.push({
        id: "overview.default:payroll_panel:totals",
        type: "payroll_panel",
        slot: "side",
        priority: 9,
        props: { title: "Payroll" },
      });
      return out;
    },
  },
  {
    leafId: "investigation.by_time",
    title: () => "Revenue investigation: the trend",
    layout: "investigation",
    requiresData: ["has_time_series", "has_two_periods"],
    required: ["investigation.by_time:kpi:revenue", "investigation.by_time:chart:trend"],
    supportsFilters: [],
    build: ({ facts, answers, density }) => {
      const id = "investigation.by_time";
      const out = [
        ...kpis(id, facts, answers, 2),
        trendChart(id, facts, answers, 0),
        insight(id, "why", "What changed", facts, INVESTIGATION_FACTS, 0),
      ];
      if (density >= 1) out.push(periodChart(id, facts, 1));
      if (density >= 2) out.push(segmentChart(id, facts, 2, null));
      return out;
    },
  },
  {
    leafId: "investigation.by_segment",
    title: titleFor("Revenue investigation: {segment} drove the change"),
    layout: "investigation",
    requiresData: ["has_segments", "has_two_periods"],
    required: ["investigation.by_segment:kpi:revenue", "investigation.by_segment:chart:segments"],
    supportsFilters: ["high_impact", "declining", "top_n"],
    build: ({ facts, answers, density, filter }) => {
      const id = "investigation.by_segment";
      const out = [
        ...kpis(id, facts, answers, 2),
        segmentChart(id, facts, 0, filter),
        insight(id, "why", "What changed", facts, INVESTIGATION_FACTS, 0),
      ];
      if (density >= 1) out.push(segmentTable(id, facts, 1));
      return out;
    },
  },
  {
    leafId: "investigation.by_customer",
    title: () => "Customers driving the decline",
    layout: "investigation",
    requiresData: ["has_customers", "has_two_periods"],
    required: [
      "investigation.by_customer:kpi:revenue",
      "investigation.by_customer:table:customers",
    ],
    supportsFilters: CUSTOMER_FILTERS,
    build: (input) => {
      const id = "investigation.by_customer";
      const { facts, answers, density } = input;
      const out = [
        ...kpis(id, facts, answers, 2),
        customerTable(
          id,
          "customers",
          "Customers with the biggest drop",
          input,
          density >= 2 ? 25 : 12,
          0,
        ),
        insight(id, "who", "Who is behind it", facts, CUSTOMER_FACTS, 0),
      ];
      if (density >= 1) out.push(segmentChart(id, facts, 1, null));
      if (
        noulAnswer(answers, "show_actions") &&
        (noulAnswer(answers, "show_actions")?.p ?? 0) >= 0.5
      )
        out.push(actionPanel(id, 1));
      return out;
    },
  },
  {
    leafId: "comparison.period_vs_period",
    title: () => "Last 3 months vs the prior 3 months",
    layout: "comparison",
    requiresData: ["has_two_periods"],
    required: ["comparison.period_vs_period:chart:periods"],
    supportsFilters: [],
    build: ({ facts, answers, density }) => {
      const id = "comparison.period_vs_period";
      const out = [...kpis(id, facts, answers, 4), periodChart(id, facts, 0)];
      if (density >= 1)
        out.push(
          insight(
            id,
            "diff",
            "The difference",
            facts,
            [
              "revenue.change_pct",
              "orders.change_pct",
              "profit.change_pct",
              "customer_count.change_pct",
            ],
            0,
          ),
        );
      return out;
    },
  },
  {
    leafId: "comparison.segment_vs_segment",
    title: () => "Segments side by side",
    layout: "comparison",
    requiresData: ["has_segments", "has_two_periods"],
    required: ["comparison.segment_vs_segment:chart:segments"],
    supportsFilters: [],
    build: ({ facts, answers, density }) => {
      const id = "comparison.segment_vs_segment";
      const out = [...kpis(id, facts, answers, 1), segmentChart(id, facts, 0, null)];
      if (density >= 1) out.push(segmentTable(id, facts, 1));
      return out;
    },
  },
  {
    leafId: "customers.list",
    title: () => "Customers",
    layout: "customers",
    requiresData: ["has_customers"],
    required: ["customers.list:table:customers"],
    supportsFilters: CUSTOMER_FILTERS,
    build: (input) => {
      const id = "customers.list";
      const out = [
        kpi(id, input.facts, "customer_count", 0),
        customerTable(id, "customers", "Customers by change in revenue", input, 25, 0),
      ];
      if (input.density >= 1)
        out.push(insight(id, "who", "At a glance", input.facts, CUSTOMER_FACTS, 0));
      return out;
    },
  },
  {
    leafId: "customers.at_risk",
    title: () => "Customers at risk",
    layout: "customers",
    requiresData: ["has_customers", "has_two_periods"],
    required: ["customers.at_risk:table:customers"],
    supportsFilters: CUSTOMER_FILTERS,
    build: (input) => {
      const id = "customers.at_risk";
      const scoped = { ...input, filter: input.filter ?? "declining" };
      return [
        kpi(id, input.facts, "customer_count", 0),
        customerTable(id, "customers", "Customers buying less or gone quiet", scoped, 25, 0),
        insight(id, "risk", "Risk summary", input.facts, CUSTOMER_FACTS, 0),
      ];
    },
  },
  {
    leafId: "action.recommendations",
    title: () => "What to do next",
    layout: "action",
    requiresData: ["has_customers"],
    required: ["action.recommendations:action:next"],
    supportsFilters: [],
    build: (input) => {
      const id = "action.recommendations";
      const scoped = { ...input, filter: "recoverable" };
      return [
        kpi(id, input.facts, "revenue", 0),
        {
          ...customerTable(
            id,
            "recoverable",
            "Start with the customers you can still win back",
            scoped,
            12,
            0,
          ),
        },
        actionPanel(id, 0),
        insight(
          id,
          "plan",
          "Why these actions",
          input.facts,
          ["customers.recoverable.count", "segment.top_contributor", "revenue.change_pct"],
          1,
        ),
      ];
    },
  },
];

export const LEAF_IDS = templates.map((t) => t.leafId);
