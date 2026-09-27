import { readFileSync } from "node:fs";
import { getFact } from "@morph/core";
import { describe, expect, it } from "vitest";
import { generateSalesCsv } from "../../scripts/generate-sales";
import {
  computeSalesFacts,
  parseSalesCsv,
  type SalesRow,
  salesUntrusted,
  tsFactsEngine,
} from "./index";

const csv = readFileSync(new URL("../../data/sales.csv", import.meta.url), "utf8");
const rows = parseSalesCsv(csv);
const facts = computeSalesFacts({ rows });
const value = (id: string) => getFact(facts, id)?.value;
const segmentOf = new Map(rows.map((r) => [r.customerId, r.segment]));

describe("committed sales.csv", () => {
  it("is exactly what the seeded generator produces", () => {
    expect(generateSalesCsv()).toBe(csv);
  });

  it("has the shape from SPEC §13.2", () => {
    const months = new Set(rows.map((r) => r.date.slice(0, 7)));
    expect(months.size).toBe(24);
    expect(new Set(rows.map((r) => r.customerId)).size).toBe(200);
    expect([...new Set(rows.map((r) => r.segment))].sort()).toEqual([
      "Education",
      "Enterprise",
      "Mid-Market",
      "Public Sector",
      "SMB",
    ]);
    expect(rows.length).toBeGreaterThan(18_000);
    expect(rows.length).toBeLessThan(23_000);
  });
});

describe("the planted story (SPEC §13.2)", () => {
  it("revenue fell about 17% in the last 3 months vs the prior 3", () => {
    const change = value("revenue.change_pct.last_3m");
    expect(change).toBeGreaterThanOrEqual(-18);
    expect(change).toBeLessThanOrEqual(-16);
    expect(getFact(facts, "revenue.change_pct.last_3m")?.bucket).toBe("large_decline");
    expect(getFact(facts, "revenue.change_pct.last_3m")?.text).toBe(
      "Revenue fell 17% vs the prior 3 months (large decline).",
    );
  });

  it("Enterprise is the top contributor and drives most of the drop", () => {
    expect(value("segment.top_contributor")).toBe("Enterprise");
    expect(value("segment.enterprise.contribution_pct")).toBeGreaterThan(50);
    expect(value("segment.enterprise.revenue_change_pct.last_3m")).toBeLessThan(-15);
  });

  it("7 recoverable Enterprise customers; the other 5 decliners stopped ordering", () => {
    expect(facts.filters.recoverable).toHaveLength(7);
    expect(value("customers.recoverable.count")).toBe(7);
    expect(value("customers.lapsed.count")).toBe(5);
    for (const id of facts.filters.recoverable ?? []) expect(segmentOf.get(id)).toBe("Enterprise");
  });

  it("the top contributing customers are Enterprise decliners", () => {
    const contributors = facts.items.filter((f) =>
      /^customer\.c_\d+\.revenue_change_usd/.test(f.id),
    );
    expect(contributors).toHaveLength(10);
    for (const f of contributors) {
      expect(segmentOf.get(f.id.split(".")[1] as string)).toBe("Enterprise");
      expect(f.value).toBeLessThan(0);
    }
  });

  it("flags the drop as a revenue anomaly", () => {
    expect(getFact(facts, "revenue.anomaly.2026-06")?.bucket).toBe("anomaly_low");
  });
});

describe("computeSalesFacts", () => {
  it("builds every filter set and capability", () => {
    expect(Object.keys(facts.filters).sort()).toEqual([
      "declining",
      "high_impact",
      "recoverable",
      "top_n",
    ]);
    expect(facts.filters.top_n).toHaveLength(10);
    expect(facts.filters.high_impact).toHaveLength(10);
    expect(facts.filters.declining?.length).toBeGreaterThan(12);
    expect(facts.capabilities.map((c) => c.id)).toEqual([
      "has_time_series",
      "has_two_periods",
      "has_segments",
      "has_customers",
    ]);
  });

  it("has unique fact IDs, a code-generated sentence for each, and a monthly series", () => {
    const ids = facts.items.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of facts.items) expect(f.text).toMatch(/^[A-Z0-9$].*\.$/);
    for (const m of ["revenue", "orders", "profit", "customer_count"]) {
      expect(ids.filter((id) => id.startsWith(`${m}.month.`))).toHaveLength(24);
    }
  });

  it("never puts dataset strings (customer names) into facts (I5)", () => {
    const names = new Set(rows.map((r) => r.customerName));
    const serialized = JSON.stringify(facts);
    for (const name of names) expect(serialized).not.toContain(name);
  });

  it("is deterministic", async () => {
    expect(await tsFactsEngine.compute({ rows })).toEqual(facts);
  });

  it("throws on an empty dataset", () => {
    expect(() => computeSalesFacts({ rows: [] })).toThrow(/no rows/);
  });
});

describe("computeSalesFacts on a small synthetic dataset", () => {
  const row = (date: string, customerId: string, segment: string, revenue: number): SalesRow => ({
    orderId: `${date}-${customerId}`,
    date,
    customerId,
    customerName: `Name of ${customerId}`,
    segment,
    revenue,
    profit: revenue / 4,
  });
  // Six months, Jan–Jun 2026. c1 stays flat; c2 grows; c3 starts in the last window.
  const small: SalesRow[] = [];
  for (const m of ["01", "02", "03", "04", "05", "06"]) {
    small.push(row(`2026-${m}-10`, "c1", "Alpha", 100));
    small.push(row(`2026-${m}-12`, "c2", "Beta", m > "03" ? 300 : 100));
  }
  small.push(row("2026-06-20", "c3", "Beta", 50));
  const f = computeSalesFacts({ rows: small, datasetId: "tiny" });
  const v = (id: string) => getFact(f, id)?.value;

  it("reports growth and names the growing segment", () => {
    expect(f.datasetId).toBe("tiny");
    expect(v("revenue.change_pct.last_3m")).toBe(108.3);
    expect(getFact(f, "revenue.change_pct.last_3m")?.text).toBe(
      "Revenue rose 108% vs the prior 3 months (strong growth).",
    );
    expect(v("segment.top_contributor")).toBe("Beta");
    expect(getFact(f, "segment.top_contributor")?.text).toContain("growth");
    expect(v("customer_count.change_pct.last_3m")).toBe(50);
  });

  it("uses 100% for growth from zero and lists growing customers as contributors", () => {
    expect(getFact(f, "customer.c3.revenue_change_usd.last_3m")?.text).toContain("+100%");
    expect(getFact(f, "customer.c2.revenue_change_usd.last_3m")?.value).toBe(600);
    expect(getFact(f, "customer.c1.revenue_change_usd.last_3m")).toBeUndefined();
  });

  it("finds no anomalies without 6 trailing months and no recoverable customers", () => {
    expect(v("revenue.anomaly.count")).toBe(0);
    expect(getFact(f, "revenue.anomaly.count")?.text).toMatch(/^No month/);
    expect(f.filters.recoverable).toEqual([]);
    expect(f.filters.declining).toEqual([]);
    expect(f.filters.top_n).toEqual(["c2", "c1", "c3"]);
  });

  it("treats an unchanged total as flat with no top contributor", () => {
    const flat = computeSalesFacts({
      rows: small.filter((r) => r.customerId === "c1"),
    });
    expect(getFact(flat, "revenue.change_pct.last_3m")?.text).toBe(
      "Revenue was flat vs the prior 3 months (flat).",
    );
    expect(getFact(flat, "segment.top_contributor")).toBeUndefined();
    expect(flat.capabilities.map((c) => c.id)).toEqual([
      "has_time_series",
      "has_two_periods",
      "has_customers",
    ]);
  });

  it("uses asOf for recency", () => {
    // c1 drops 60% in the last window and its last order is Jun 10.
    const dropping = small.map((r) =>
      r.customerId === "c1" && r.date >= "2026-04" ? { ...r, revenue: 40 } : r,
    );
    expect(computeSalesFacts({ rows: dropping }).filters.recoverable).toEqual(["c1"]);
    const late = computeSalesFacts({ rows: dropping, asOf: "2026-09-01" });
    expect(late.filters.recoverable).toEqual([]);
    // c3 had no prior-window revenue, so only c1 and c2 count as lapsed.
    expect(getFact(late, "customers.lapsed.count")?.value).toBe(2);
  });

  it("flags an unusual month against the trailing 6", () => {
    const series: SalesRow[] = [];
    const months = ["2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"];
    months.forEach((m, i) => {
      series.push(row(`${m}-05`, "c1", "Alpha", i === 6 ? 1000 : 100 + (i % 2)));
    });
    const out = computeSalesFacts({ rows: series });
    expect(getFact(out, "revenue.anomaly.2026-01")?.bucket).toBe("anomaly_high");
    expect(getFact(out, "revenue.anomaly.count")?.text).toBe(
      "1 month had unusual revenue compared with the 6 months before.",
    );
  });
});

describe("salesUntrusted", () => {
  it("maps customer IDs to names under untrusted", () => {
    const u = salesUntrusted(rows.slice(0, 3));
    expect(u).toEqual({
      customer_names: Object.fromEntries(
        rows.slice(0, 3).map((r) => [r.customerId, r.customerName]),
      ),
    });
  });
});

describe("parseSalesCsv", () => {
  const header = "order_id,date,customer_id,customer_name,segment,revenue,profit";
  it("parses and coerces numbers", () => {
    expect(parseSalesCsv(`${header}\no_1,2026-01-02,c_1,"Acme, Inc",SMB,10.50,2.25\n`)).toEqual([
      {
        orderId: "o_1",
        date: "2026-01-02",
        customerId: "c_1",
        customerName: "Acme, Inc",
        segment: "SMB",
        revenue: 10.5,
        profit: 2.25,
      },
    ]);
  });
  it("rejects malformed rows with a line number", () => {
    expect(() => parseSalesCsv(`${header}\no_1,02/01/2026,c_1,A,SMB,1,1\n`)).toThrow(/line 2/);
    expect(() => parseSalesCsv(`${header}\no_1,2026-01-02,c_1,A,SMB,abc,1\n`)).toThrow(/line 2/);
    expect(() => parseSalesCsv(`${header}\no_1,2026-01-02,c_1\n`)).toThrow(/row/);
  });
});
