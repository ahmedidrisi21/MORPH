import type { MorphContext } from "morph-core";
import { describe, expect, it } from "vitest";
import { computeSalesFacts, type SalesFacts, type SalesRow } from "../facts";
import { fmtMonth } from "./format";
import { createDemoMorph, DEMO_USER } from "./index";
import { MAX_CHART_HIGHLIGHTS, MAX_CHART_POINTS, registry } from "./registry";
import { createRulesProvider } from "./rules";
import { LEAF_IDS } from "./templates";

/** `months` consecutive months ending Aug 2026, three orders a month from six customers. */
function history(months: number): SalesRow[] {
  const rows: SalesRow[] = [];
  for (let i = 0; i < months; i++) {
    const idx = 2026 * 12 + 7 - (months - 1 - i);
    const month = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
    for (let c = 0; c < 6; c++) {
      for (const day of ["03", "12", "21"]) {
        rows.push({
          orderId: `${month}-${day}-c${c}`,
          date: `${month}-${day}`,
          customerId: `c${c}`,
          customerName: `Customer ${c}`,
          segment: c % 2 ? "SMB" : "Enterprise",
          revenue: 1000 + c * 10 + (i % 5),
          cost: 600,
        });
      }
    }
  }
  return rows;
}

function composeLeaf(leafId: string, facts: SalesFacts) {
  const morph = createDemoMorph({ provider: createRulesProvider() });
  const ctx: MorphContext = {
    intent: { raw: "", history: [] },
    user: DEMO_USER,
    facts,
    ui: { workspaceId: null, componentIds: [], lastMorphAt: null, activeFilter: null },
    now: Date.UTC(2026, 8, 1),
  };
  return morph.composeLeaf(leafId, ctx);
}

describe("chart props stay within the registry limits", () => {
  const long = computeSalesFacts(history(70));

  it("every workspace composes valid props for a 70-month history", () => {
    const invalid: string[] = [];
    for (const leafId of LEAF_IDS) {
      for (const c of composeLeaf(leafId, long).components) {
        const v = registry.validateProps(c.type, c.props);
        if (!v.ok) invalid.push(`${c.id}: ${v.error}`);
      }
    }
    expect(invalid).toEqual([]);
  });

  it("the trend chart shows the most recent months and says so", () => {
    const chart = composeLeaf("investigation.by_time", long).components.find(
      (c) => c.id === "investigation.by_time:chart:trend",
    );
    const props = chart?.props as { data: { month: string }[]; caption: string };
    expect(props.data).toHaveLength(MAX_CHART_POINTS);
    expect(props.data.at(-1)?.month).toBe(fmtMonth("2026-08"));
    expect(props.data[0]?.month).toBe(
      fmtMonth(long.sales.months.at(-MAX_CHART_POINTS)?.month ?? ""),
    );
    expect(props.caption).toMatch(/^Showing the last 60 months\./);
  });

  it("a short history is shown whole, with no truncation note", () => {
    const short = computeSalesFacts(history(24));
    const chart = composeLeaf("investigation.by_time", short).components.find(
      (c) => c.id === "investigation.by_time:chart:trend",
    );
    const props = chart?.props as { data: unknown[]; caption: string };
    expect(props.data).toHaveLength(24);
    expect(props.caption).not.toMatch(/Showing/);
  });

  it("caps highlights, keeping the last 3 months and the newest anomalies", () => {
    const noisy: SalesFacts = {
      ...long,
      sales: { ...long.sales, months: long.sales.months.map((m) => ({ ...m, anomaly: true })) },
    };
    const chart = composeLeaf("overview.default", noisy).components.find(
      (c) => c.id === "overview.default:chart:trend",
    );
    const props = chart?.props as { highlight: string[] } | undefined;
    const highlight = props?.highlight ?? [];
    expect(highlight).toHaveLength(MAX_CHART_HIGHLIGHTS);
    for (const m of ["2026-06", "2026-07", "2026-08"]) expect(highlight).toContain(fmtMonth(m));
    expect(highlight).not.toContain(fmtMonth(long.sales.months.at(-MAX_CHART_POINTS)?.month ?? ""));
    expect(registry.validateProps("chart", chart?.props).ok).toBe(true);
  });
});

describe("comparisons the data cannot support", () => {
  const kpiProps = (leafId: string, facts: SalesFacts, metric: string) =>
    composeLeaf(leafId, facts).components.find((c) => c.id === `${leafId}:kpi:${metric}`)?.props as
      | { value: string; tone: string; delta?: string }
      | undefined;

  it("shows a KPI value alone when there is no prior period", () => {
    // Four months: no prior window, so no change fact exists.
    const facts = computeSalesFacts(history(4));
    expect(facts.capabilities.map((c) => c.id)).not.toContain("has_two_periods");
    const kpi = kpiProps("overview.default", facts, "revenue");
    expect(kpi?.value).toBeDefined();
    expect(kpi?.tone).toBe("flat");
    expect(kpi).not.toHaveProperty("delta");
  });

  it("still shows the change when there is a prior period", () => {
    const kpi = kpiProps("overview.default", computeSalesFacts(history(12)), "revenue");
    expect(kpi?.delta).toMatch(/vs prior 3 months$/);
  });
});

describe("the partial-month note", () => {
  const noteId = (leafId: string) => `${leafId}:alert:partial_month`;
  const note = (leafId: string, facts: SalesFacts) =>
    composeLeaf(leafId, facts).components.find((c) => c.id === noteId(leafId));
  /** A full year of data whose last order is on `lastDay` of Aug 2026. */
  const endingOn = (lastDay: string): SalesFacts =>
    computeSalesFacts([
      ...history(12).filter((r) => r.date < "2026-08"),
      ...history(12)
        .filter((r) => r.date.startsWith("2026-08"))
        .map((r) => ({ ...r, date: `2026-08-${lastDay}` })),
    ]);

  it("appears on workspaces that compare periods when the last month is incomplete", () => {
    const facts = endingOn("20");
    expect(facts.sales.latestMonthPartial).toBe(true);
    for (const leafId of [
      "overview.default",
      "investigation.by_time",
      "investigation.by_segment",
      "investigation.by_customer",
      "comparison.period_vs_period",
      "comparison.segment_vs_segment",
    ]) {
      const n = note(leafId, facts);
      expect(n?.type, leafId).toBe("alert");
      const props = n?.props as { text: string } | undefined;
      expect(props?.text, leafId).toContain("2026-08-20");
      expect(registry.validateProps("alert", n?.props).ok).toBe(true);
    }
  });

  it("is absent when the data reaches the end of its last month", () => {
    const facts = endingOn("31");
    expect(facts.sales.latestMonthPartial).toBe(false);
    expect(note("overview.default", facts)).toBeUndefined();
    expect(note("investigation.by_time", facts)).toBeUndefined();
  });
});
