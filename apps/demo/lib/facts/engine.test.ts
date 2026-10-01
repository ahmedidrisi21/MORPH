import { readFileSync } from "node:fs";
import { getFact } from "morph-core";
import { describe, expect, it } from "vitest";
import { ADVERSARIAL_CUSTOMER_NAME, generateSalesCsv } from "../../scripts/generate-sales";
import { customerNames, parseSalesCsv, type SalesRow, tsFactsEngine } from "./index";

const csv = readFileSync(new URL("../../data/sales.csv", import.meta.url), "utf8");
const rows = parseSalesCsv(csv);
const facts = tsFactsEngine.computeSync(rows);
const value = (id: string) => getFact(facts, id)?.value;
const segmentOf = new Map(rows.map((r) => [r.customerId, r.segment]));

describe("committed sales.csv", () => {
  it("is exactly what the seeded generator produces", () => {
    expect(generateSalesCsv()).toBe(csv);
  });

  it("has the shape from SPEC §13.2", () => {
    expect(new Set(rows.map((r) => r.date.slice(0, 7))).size).toBe(24);
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

  it("contains the adversarial customer name for G09", () => {
    expect(rows.some((r) => r.customerName === ADVERSARIAL_CUSTOMER_NAME)).toBe(true);
  });
});

describe("the planted story (SPEC §13.2)", () => {
  it("revenue fell about 17% in the last 3 months vs the prior 3", () => {
    const change = value("revenue.change_pct");
    expect(change).toBeGreaterThanOrEqual(-18);
    expect(change).toBeLessThanOrEqual(-16);
    expect(getFact(facts, "revenue.change_pct")?.bucket).toBe("large_decline");
    expect(getFact(facts, "revenue.change_pct")?.text).toBe(
      "Revenue fell 17% vs the prior 3 months (large decline).",
    );
  });

  it("Enterprise is the top contributor and drives most of the drop", () => {
    expect(value("segment.top_contributor")).toBe("Enterprise");
    expect(getFact(facts, "segment.top_contributor")?.text).toBe(
      "Enterprise drove most of the revenue decline.",
    );
    expect(value("segment.top_contributor.share_pct")).toBeGreaterThan(50);
    expect(value("segment.enterprise.change_pct")).toBeLessThan(-15);
    expect(facts.sales.segments[0]?.segment).toBe("Enterprise");
  });

  it("12 Enterprise decliners: 7 recoverable, 5 stopped ordering", () => {
    expect(facts.filters.recoverable).toHaveLength(7);
    expect(value("customers.recoverable.count")).toBe(7);
    expect(value("customers.churned.count")).toBe(5);
    const decliners = facts.sales.customers.filter(
      (c) => c.revenueLast <= c.revenuePrior * 0.7 && c.revenuePrior > 0,
    );
    expect(decliners).toHaveLength(12);
    for (const c of decliners) expect(c.segment).toBe("Enterprise");
  });

  it("the biggest losses are Enterprise customers", () => {
    for (const id of facts.filters.high_impact ?? []) expect(segmentOf.get(id)).toBe("Enterprise");
    expect(value("customers.top_loss.change")).toBe(facts.sales.customers[0]?.change);
    expect(value("customers.top_loss.change")).toBeLessThan(0);
  });

  it("flags the drop as a revenue anomaly", () => {
    const june = facts.sales.months.find((m) => m.month === "2026-06");
    expect(june?.anomaly).toBe(true);
    expect(june?.z).toBeLessThan(-2);
    expect(value("revenue.anomaly.count")).toBe(facts.sales.months.filter((m) => m.anomaly).length);
  });
});

describe("computeSync", () => {
  it("returns every contracted fact ID", () => {
    const expected = [
      ...["revenue", "orders", "profit", "customer_count"].flatMap((m) => [
        `${m}.last_3m`,
        `${m}.prior_3m`,
        `${m}.change_pct`,
      ]),
      "segment.top_contributor",
      "segment.top_contributor.share_pct",
      ...["education", "enterprise", "mid_market", "public_sector", "smb"].map(
        (s) => `segment.${s}.change_pct`,
      ),
      "customers.declining.count",
      "customers.recoverable.count",
      "customers.churned.count",
      "customers.top_loss.change",
      "revenue.anomaly.count",
      "revenue.latest_month.change_pct",
    ];
    expect(facts.items.map((f) => f.id)).toEqual(expected);
    for (const f of facts.items) expect(f.text).toMatch(/^[A-Z0-9$].*\.$/);
  });

  it("builds the sales block", () => {
    expect(facts.sales.asOf).toBe(
      rows
        .map((r) => r.date)
        .sort()
        .at(-1),
    );
    expect(facts.sales.months).toHaveLength(24);
    expect(facts.sales.months[0]?.z).toBe(0);
    expect(facts.sales.segments).toHaveLength(5);
    expect(facts.sales.customers).toHaveLength(200);
    const changes = facts.sales.customers.map((c) => c.change);
    expect(changes).toEqual([...changes].sort((a, b) => a - b));
  });

  it("builds every filter set and capability", () => {
    expect(Object.keys(facts.filters).sort()).toEqual([
      "declining",
      "high_impact",
      "recoverable",
      "top_n",
    ]);
    expect(facts.filters.top_n).toHaveLength(10);
    expect(facts.filters.high_impact).toHaveLength(10);
    expect(facts.capabilities.map((c) => c.id)).toEqual([
      "has_time_series",
      "has_two_periods",
      "has_segments",
      "has_customers",
    ]);
    for (const c of facts.capabilities) expect(c.description).not.toMatch(/\d/);
  });

  it("never puts dataset strings (customer names) into facts (I5)", () => {
    const serialized = JSON.stringify(facts);
    for (const name of new Set(rows.map((r) => r.customerName))) {
      expect(serialized).not.toContain(name);
    }
  });

  it("matches the async engine and is deterministic", async () => {
    expect(await tsFactsEngine.compute(rows)).toEqual(facts);
  });

  it("throws on an empty dataset", () => {
    expect(() => tsFactsEngine.computeSync([])).toThrow(/no rows/);
  });
});

describe("computeSync on a small synthetic dataset", () => {
  const row = (date: string, customerId: string, segment: string, revenue: number): SalesRow => ({
    orderId: `${date}-${customerId}`,
    date,
    customerId,
    customerName: `Name of ${customerId}`,
    segment,
    revenue,
    cost: revenue * 0.75,
  });
  // Six months, Jan–Jun 2026. c1 stays flat; c2 triples; c3 starts in the last window.
  const small: SalesRow[] = [];
  for (const m of ["01", "02", "03", "04", "05", "06"]) {
    small.push(row(`2026-${m}-10`, "c1", "Alpha", 100));
    small.push(row(`2026-${m}-12`, "c2", "Beta", m > "03" ? 300 : 100));
  }
  small.push(row("2026-06-20", "c3", "Beta", 50));
  const f = tsFactsEngine.computeSync(small);
  const v = (id: string) => getFact(f, id)?.value;

  it("reports growth and names the growing segment", () => {
    expect(v("revenue.change_pct")).toBe(108.3);
    expect(getFact(f, "revenue.change_pct")?.text).toBe(
      "Revenue rose 108% vs the prior 3 months (strong growth).",
    );
    expect(v("profit.last_3m")).toBe(313);
    expect(v("segment.top_contributor")).toBe("Beta");
    expect(getFact(f, "segment.top_contributor")?.text).toContain("growth");
    expect(v("customer_count.change_pct")).toBe(50);
    expect(f.sales.asOf).toBe("2026-06-20");
  });

  it("uses 100% for growth from zero and has no losses", () => {
    expect(f.sales.customers.find((c) => c.id === "c3")?.changePct).toBe(100);
    expect(v("customers.top_loss.change")).toBe(0);
    expect(getFact(f, "customers.top_loss.change")?.text).toMatch(/^No customer/);
    expect(f.filters.declining).toEqual([]);
    expect(f.filters.top_n).toEqual(["c2", "c1", "c3"]);
  });

  it("reports the latest month vs the month before", () => {
    expect(v("revenue.latest_month.change_pct")).toBe(12.5);
    expect(getFact(f, "revenue.latest_month.change_pct")?.text).toBe(
      "Revenue in Jun 2026 rose 13% vs the month before (growth).",
    );
  });

  it("finds no anomalies without 6 trailing months", () => {
    expect(v("revenue.anomaly.count")).toBe(0);
    expect(getFact(f, "revenue.anomaly.count")?.text).toMatch(/^No month/);
  });

  it("treats an unchanged total as flat with no top contributor", () => {
    const flat = tsFactsEngine.computeSync(small.filter((r) => r.customerId === "c1"));
    expect(getFact(flat, "revenue.change_pct")?.text).toBe(
      "Revenue was flat vs the prior 3 months (flat).",
    );
    expect(getFact(flat, "revenue.latest_month.change_pct")?.text).toContain("was flat");
    expect(getFact(flat, "segment.top_contributor")).toBeUndefined();
    expect(flat.capabilities.map((c) => c.id)).toEqual([
      "has_time_series",
      "has_two_periods",
      "has_customers",
    ]);
  });

  it("uses recency from asOf for recoverable and churned", () => {
    // c1 drops 60% in the last window; its last order is Jun 10, 10 days before asOf.
    const dropping = small.map((r) =>
      r.customerId === "c1" && r.date >= "2026-04" ? { ...r, revenue: 40 } : r,
    );
    const out = tsFactsEngine.computeSync(dropping);
    expect(out.filters.recoverable).toEqual(["c1"]);
    expect(out.filters.high_impact).toEqual(["c1"]);
    expect(getFact(out, "customers.top_loss.change")?.text).toBe(
      "The biggest single-customer loss was $180 (Alpha).",
    );
    // A late order from another customer moves asOf out past 45 days for c1 and c2.
    const late = tsFactsEngine.computeSync([...dropping, row("2026-07-31", "c3", "Beta", 5)]);
    expect(late.filters.recoverable).toEqual([]);
    expect(getFact(late, "customers.churned.count")?.value).toBe(2);
  });

  it("flags an unusual month against the trailing 6", () => {
    const months = ["2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"];
    const series = months.map((m, i) =>
      row(`${m}-05`, "c1", "Alpha", i === 6 ? 1000 : 100 + (i % 2)),
    );
    const out = tsFactsEngine.computeSync(series);
    expect(out.sales.months.at(-1)?.anomaly).toBe(true);
    expect(getFact(out, "revenue.anomaly.count")?.text).toBe(
      "1 month had unusual revenue compared with the 6 months before.",
    );
    const flatSeries = months.map((m) => row(`${m}-05`, "c1", "Alpha", 100));
    expect(tsFactsEngine.computeSync(flatSeries).sales.months.at(-1)?.z).toBe(0);
  });
});

describe("data that cannot support a comparison", () => {
  const order = (
    month: string,
    customerId: string,
    segment: string,
    revenue: number,
  ): SalesRow => ({
    orderId: `${month}-${customerId}`,
    date: `${month}-28`,
    customerId,
    customerName: `Name of ${customerId}`,
    segment,
    revenue,
    cost: 0,
  });
  /** One order per segment per month; `amount(segment, month)` decides the revenue. */
  const series = (
    months: string[],
    amount: (segment: string, month: string) => number,
    segments = ["Alpha", "Beta"],
  ): SalesRow[] => months.flatMap((m) => segments.map((s) => order(m, `c_${s}`, s, amount(s, m))));
  const ids = (f: ReturnType<typeof tsFactsEngine.computeSync>) => f.items.map((i) => i.id);
  const caps = (f: ReturnType<typeof tsFactsEngine.computeSync>) => f.capabilities.map((c) => c.id);

  it("has no two periods when the prior window is empty, even with 6+ months of data", () => {
    // Last window Aug–Oct, prior window May–Jul. Both are missing; Jan–Apr and Aug–Oct remain.
    const months = ["01", "02", "03", "04", "08", "09", "10"].map((m) => `2026-${m}`);
    const f = tsFactsEngine.computeSync(series(months, () => 100));
    expect(caps(f)).not.toContain("has_two_periods");
    expect(ids(f)).toContain("revenue.last_3m");
    expect(ids(f)).not.toContain("revenue.prior_3m");
    expect(ids(f)).not.toContain("revenue.change_pct");
    expect(ids(f).some((id) => id.startsWith("segment."))).toBe(false);
    for (const item of f.items) expect(item.text).not.toMatch(/100%/);
  });

  it("accepts sparse months when both windows have orders", () => {
    // Jun and Jul have no orders at all, but May (prior) and Aug–Oct (last) do.
    const months = ["05", "08", "09", "10"].map((m) => `2026-${m}`);
    const f = tsFactsEngine.computeSync(series(months, (_s, m) => (m === "2026-05" ? 300 : 100)));
    expect(caps(f)).toContain("has_two_periods");
    // Prior window revenue is 300 per segment, last window 300 per segment.
    expect(getFact(f, "revenue.prior_3m")?.value).toBe(600);
    expect(getFact(f, "revenue.change_pct")?.value).toBe(0);
  });

  it("gives no percentage for a metric that was zero in the prior window", () => {
    const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
    // Orders exist in the prior window (Jan–Mar) but carry no revenue; revenue starts in Apr.
    const f = tsFactsEngine.computeSync(series(months, (_s, m) => (m >= "2026-04" ? 100 : 0)));
    expect(caps(f)).toContain("has_two_periods");
    expect(ids(f)).toContain("revenue.prior_3m");
    expect(ids(f)).not.toContain("revenue.change_pct");
    expect(ids(f)).not.toContain("profit.change_pct");
    expect(getFact(f, "orders.change_pct")?.value).toBe(0);
  });

  it("names no segment for a net change that is noise", () => {
    const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
    // Prior 1000/month per segment (6000 total). Last: Alpha 1030, Beta 969 -> a net change of -3.
    const noise = tsFactsEngine.computeSync(
      series(months, (s, m) => (m < "2026-04" ? 1000 : s === "Alpha" ? 1030 : 969)),
    );
    expect(noise.sales.segments.map((s) => s.contributionPct)).toEqual([0, 0]);
    expect(ids(noise)).not.toContain("segment.top_contributor");
    expect(ids(noise)).not.toContain("segment.top_contributor.share_pct");
    // A net change of -600 (10% of the prior revenue) is real: Beta drove all of it.
    const real = tsFactsEngine.computeSync(
      series(months, (s, m) => (m < "2026-04" ? 1000 : s === "Alpha" ? 1000 : 800)),
    );
    expect(getFact(real, "segment.top_contributor")?.value).toBe("Beta");
    expect(getFact(real, "segment.top_contributor.share_pct")?.value).toBe(100);
  });

  it("skips the change fact for a segment that had no prior revenue", () => {
    const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
    const rows = [
      ...series(months, () => 100),
      order("2026-05", "c_new", "Gamma", 500),
      order("2026-06", "c_new", "Gamma", 500),
    ];
    const f = tsFactsEngine.computeSync(rows);
    expect(ids(f)).toContain("segment.alpha.change_pct");
    expect(ids(f)).not.toContain("segment.gamma.change_pct");
  });

  it("skips the latest-month change without a month before, or with zero revenue before", () => {
    expect(ids(tsFactsEngine.computeSync(series(["2026-06"], () => 100)))).not.toContain(
      "revenue.latest_month.change_pct",
    );
    const f = tsFactsEngine.computeSync(
      series(["2026-05", "2026-06"], (_s, m) => (m === "2026-05" ? 0 : 100)),
    );
    expect(ids(f)).not.toContain("revenue.latest_month.change_pct");
  });
});

describe("latestMonthPartial", () => {
  const partial = (date: string) =>
    tsFactsEngine.computeSync([
      {
        orderId: "o",
        date,
        customerId: "c",
        customerName: "n",
        segment: "s",
        revenue: 1,
        cost: 0,
      },
    ]).sales.latestMonthPartial;

  it("is true only when the data stops before the last day of its month", () => {
    expect(partial("2026-06-20")).toBe(true);
    expect(partial("2026-06-29")).toBe(true);
    expect(partial("2026-06-30")).toBe(false);
    expect(partial("2026-07-30")).toBe(true);
    expect(partial("2026-07-31")).toBe(false);
  });

  it("handles February in leap and common years", () => {
    expect(partial("2028-02-28")).toBe(true);
    expect(partial("2028-02-29")).toBe(false);
    expect(partial("2027-02-27")).toBe(true);
    expect(partial("2027-02-28")).toBe(false);
  });

  it("is false for the committed demo data", () => {
    expect(facts.sales.latestMonthPartial).toBe(false);
  });
});

describe("customerNames", () => {
  it("maps customer IDs to names", () => {
    const some = rows.slice(0, 3);
    expect(customerNames(some)).toEqual(
      Object.fromEntries(some.map((r) => [r.customerId, r.customerName])),
    );
  });
});

describe("parseSalesCsv", () => {
  const header = "order_id,date,customer_id,customer_name,segment,revenue,cost";
  it("parses and coerces numbers", () => {
    expect(parseSalesCsv(`${header}\no_1,2026-01-02,c_1,"Acme, Inc",SMB,10.50,2.25\n`)).toEqual([
      {
        orderId: "o_1",
        date: "2026-01-02",
        customerId: "c_1",
        customerName: "Acme, Inc",
        segment: "SMB",
        revenue: 10.5,
        cost: 2.25,
      },
    ]);
  });
  it("rejects malformed rows with a line number", () => {
    expect(() => parseSalesCsv(`${header}\no_1,02/01/2026,c_1,A,SMB,1,1\n`)).toThrow(/line 2/);
    expect(() => parseSalesCsv(`${header}\no_1,2026-01-02,c_1,A,SMB,abc,1\n`)).toThrow(/line 2/);
    expect(() => parseSalesCsv(`${header}\no_1,2026-01-02,c_1\n`)).toThrow(/row/);
  });
});
