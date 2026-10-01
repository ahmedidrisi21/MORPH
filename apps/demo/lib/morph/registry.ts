import { type ActionDef, type CapabilityDef, createRegistry } from "morph-core";
import { z } from "zod";

/** Registered action IDs: the closed enum the narrative tier may reference (I14). */
export const ACTION_IDS = [
  "email_customers",
  "schedule_calls",
  "export_list",
  "offer_discount",
] as const;
export type ActionId = (typeof ACTION_IDS)[number];

export const actions: ActionDef[] = [
  { id: "email_customers", label: "Email these customers", risk: "medium", capability: "action" },
  { id: "schedule_calls", label: "Schedule account reviews", risk: "low", capability: "action" },
  { id: "export_list", label: "Export the list", risk: "low", capability: "action" },
  {
    id: "offer_discount",
    label: "Offer a win-back discount",
    risk: "critical",
    capability: "action",
  },
];

const text = z.string().max(200);

/** Chart limits. Templates must stay within them: a required chart that fails props renders MorphError. */
export const MAX_CHART_POINTS = 60;
export const MAX_CHART_HIGHLIGHTS = 24;

export const KpiProps = z.object({
  label: text,
  value: z.string().max(40),
  delta: z.string().max(40).optional(),
  tone: z.enum(["up", "down", "flat"]),
  caption: text.optional(),
  factId: z.string().optional(),
});

export const ChartProps = z.object({
  title: text,
  kind: z.enum(["line", "bar"]),
  xKey: z.string(),
  series: z
    .array(z.object({ key: z.string(), label: text }))
    .min(1)
    .max(4),
  data: z
    .array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])))
    .max(MAX_CHART_POINTS),
  /** x values to highlight (e.g. the last 3 months, or anomalies). */
  highlight: z.array(z.string()).max(MAX_CHART_HIGHLIGHTS).optional(),
  caption: text.optional(),
});

export const TableProps = z.object({
  title: text,
  columns: z
    .array(z.object({ key: z.string(), label: text, align: z.enum(["left", "right"]).optional() }))
    .min(1)
    .max(8),
  rows: z
    .array(
      z.object({ id: z.string(), cells: z.record(z.string(), z.union([z.string(), z.number()])) }),
    )
    .max(50),
  caption: text.optional(),
  emptyText: text.optional(),
});

export const InsightProps = z.object({
  title: text,
  /** Code-generated sentences from facts: the fallback that keeps the slot from ever being blank. */
  fallback: z
    .array(z.object({ text: z.string().max(300), factId: z.string() }))
    .min(1)
    .max(6),
});

export const ActionProps = z.object({
  title: text,
  actions: z
    .array(z.object({ actionId: z.enum(ACTION_IDS), label: text, description: text }))
    .min(1)
    .max(4),
});

export const AlertProps = z.object({ tone: z.enum(["info", "warning"]), text });

export const PayrollProps = z.object({ title: text });

export const capabilities: CapabilityDef[] = [
  { type: "kpi", description: "A headline number with its change.", props: KpiProps, risk: "low" },
  {
    type: "chart",
    description: "A line or bar chart of precomputed series.",
    props: ChartProps,
    risk: "low",
  },
  { type: "table", description: "A table of precomputed rows.", props: TableProps, risk: "low" },
  {
    type: "insight",
    description: "Grounded sentences about the facts.",
    props: InsightProps,
    risk: "low",
  },
  { type: "alert", description: "A short notice.", props: AlertProps, risk: "low" },
  {
    type: "action",
    description: "Buttons for registered actions.",
    props: ActionProps,
    risk: "medium",
    // The policy decides which of these actions this user may be offered (SPEC §10).
    actions: {
      ids: (props) => (props as z.infer<typeof ActionProps>).actions.map((a) => a.actionId),
      keep: (props, allowed) => {
        const p = props as z.infer<typeof ActionProps>;
        return { ...p, actions: p.actions.filter((a) => allowed.has(a.actionId)) };
      },
    },
  },
  // Used only to prove policy denial: sales managers lack read:payroll (SPEC §10).
  {
    type: "payroll_panel",
    description: "Payroll totals.",
    props: PayrollProps,
    risk: "high",
    permission: "read:payroll",
  },
];

export const registry = createRegistry(capabilities, actions);
