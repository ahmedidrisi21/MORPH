import type { Renderers } from "@morph/react";
import { MorphAction } from "./MorphAction";
import { MorphAlert } from "./MorphAlert";
import { MorphChart } from "./MorphChart";
import { MorphInsight } from "./MorphInsight";
import { MorphKPI } from "./MorphKPI";
import { MorphPayroll } from "./MorphPayroll";
import { MorphTable } from "./MorphTable";

/** type → React component. MorphProvider asserts this matches the registry exactly. */
export const renderers = {
  kpi: MorphKPI,
  chart: MorphChart,
  table: MorphTable,
  insight: MorphInsight,
  alert: MorphAlert,
  action: MorphAction,
  payroll_panel: MorphPayroll,
} as unknown as Renderers;
