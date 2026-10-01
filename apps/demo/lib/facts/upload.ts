// CSV upload (docs/backlog.md#csv-upload, ADR 0006). A user's CSV is parsed in the browser,
// its columns are mapped onto the sales schema, and the rows go through the same facts engine
// as the demo data. Rows never leave the browser: providers still only see lens output (I4).
//
// Uploaded strings are untrusted (I5). Customer IDs are replaced by synthetic IDs before they
// reach facts, the original ID or name goes to `ctx.untrusted`, and segment labels are reduced
// to a short safe character set because segment names appear in fact text.
import Papa from "papaparse";
import { z } from "zod";
import type { SalesRow } from "./types";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_UPLOAD_ROWS = 200_000;
/** Segments beyond this many (by row count) are grouped as "Other". */
export const MAX_SEGMENTS = 12;
const SAMPLE_ROWS = 50;
const SEGMENT_LABEL = /^[A-Za-z0-9][A-Za-z0-9 &.-]{0,23}$/;

export const COLUMN_ROLES = [
  "date",
  "revenue",
  "customer",
  "customerName",
  "segment",
  "cost",
  "orderId",
] as const;
export type ColumnRole = (typeof COLUMN_ROLES)[number];
export const REQUIRED_ROLES = ["date", "revenue", "customer"] as const;

export const ROLE_LABEL: Record<ColumnRole, string> = {
  date: "Order date",
  revenue: "Revenue",
  customer: "Customer",
  customerName: "Customer name",
  segment: "Segment",
  cost: "Cost",
  orderId: "Order ID",
};

/** Role → header. Optional roles may be missing. */
export const ColumnMappingSchema = z.object({
  date: z.string().min(1),
  revenue: z.string().min(1),
  customer: z.string().min(1),
  customerName: z.string().min(1).optional(),
  segment: z.string().min(1).optional(),
  cost: z.string().min(1).optional(),
  orderId: z.string().min(1).optional(),
});
export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;
export type PartialMapping = Partial<Record<ColumnRole, string>>;

export interface CsvTable {
  headers: string[];
  records: Record<string, string>[];
}

export class CsvUploadError extends Error {
  override readonly name = "CsvUploadError";
}

/** Parses CSV text into headers and string records. Throws `CsvUploadError` with plain copy. */
export function readCsvTable(text: string): CsvTable {
  if (text.length > MAX_UPLOAD_BYTES) throw new CsvUploadError("The file is larger than 20 MB.");
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    dynamicTyping: false,
    transformHeader: (h) => h.trim(),
  });
  const fatal = parsed.errors.find((e) => e.type !== "Delimiter");
  if (fatal) throw new CsvUploadError(`Row ${(fatal.row ?? 0) + 2}: ${fatal.message}.`);
  const headers = (parsed.meta.fields ?? []).filter((h) => h.length > 0);
  if (headers.length < 3) throw new CsvUploadError("The file needs a header row and 3+ columns.");
  if (parsed.data.length === 0) throw new CsvUploadError("The file has no data rows.");
  if (parsed.data.length > MAX_UPLOAD_ROWS)
    throw new CsvUploadError(`The file has more than ${MAX_UPLOAD_ROWS.toLocaleString()} rows.`);
  return { headers, records: parsed.data };
}

// ---------------------------------------------------------------------------
// Value parsing
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");

function validDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** YYYY-MM-DD, YYYY/MM/DD, ISO date-times, or US M/D/YYYY → YYYY-MM-DD. */
export function parseDateValue(raw: string | undefined): string | null {
  const s = (raw ?? "").trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return validDate(Number(m[3]), Number(m[1]), Number(m[2]));
  return null;
}

/** "1,234.50", "$99", "(12)" → number. Empty or anything else → null. */
export function parseNumberValue(raw: string | undefined): number | null {
  let s = (raw ?? "").trim().replace(/[$€£,\s]/g, "");
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return sign * Number(s);
}

// ---------------------------------------------------------------------------
// Mapping suggestion
// ---------------------------------------------------------------------------

const NAME_HINTS: Record<ColumnRole, RegExp[]> = {
  date: [/^(order_?)?date$/, /date|day|time|created|ordered|period/],
  revenue: [/^(revenue|sales|amount)$/, /revenue|sales|amount|total|income|price|value/],
  customer: [/^(customer|client|account)_?id$/, /customer|client|account|buyer/],
  customerName: [/^(customer|client|account|company)_?name$/, /name|company/],
  segment: [/^segment$/, /segment|region|category|tier|industry|channel|type|group/],
  cost: [/^(cost|cogs)$/, /cost|cogs|expense/],
  orderId: [/^(order|invoice|transaction)_?id$/, /order|invoice|transaction|receipt/],
};

const norm = (h: string) =>
  h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

function share(sample: Record<string, string>[], header: string, ok: (v: string) => boolean) {
  const vals = sample.map((r) => r[header] ?? "").filter((v) => v.trim() !== "");
  if (vals.length === 0) return 0;
  return vals.filter(ok).length / vals.length;
}

/**
 * Guesses which column plays which role, from header names and the first rows' values.
 * Pure and deterministic; the user can change every choice before building.
 */
export function suggestMapping(table: CsvTable): PartialMapping {
  const sample = table.records.slice(0, SAMPLE_ROWS);
  const isDate = (h: string) => share(sample, h, (v) => parseDateValue(v) !== null) >= 0.9;
  const isNum = (h: string) => share(sample, h, (v) => parseNumberValue(v) !== null) >= 0.9;
  const fits: Record<ColumnRole, (h: string) => boolean> = {
    date: isDate,
    revenue: isNum,
    cost: isNum,
    customer: (h) => !isDate(h),
    customerName: (h) => !isDate(h) && !isNum(h),
    segment: (h) => !isDate(h) && !isNum(h),
    orderId: (h) => !isDate(h),
  };

  const out: PartialMapping = {};
  const used = new Set<string>();
  // Exact-ish names first (for every role), then looser ones, so "customer_name" does not
  // steal the customer role from "customer_id".
  for (const pass of [0, 1]) {
    for (const role of COLUMN_ROLES) {
      if (out[role]) continue;
      const hint = NAME_HINTS[role][pass] as RegExp;
      const h = table.headers.find((x) => !used.has(x) && hint.test(norm(x)) && fits[role](x));
      if (h) {
        out[role] = h;
        used.add(h);
      }
    }
  }
  // Fallbacks by value type for the required roles.
  if (!out.date) {
    const h = table.headers.find((x) => !used.has(x) && isDate(x));
    if (h) {
      out.date = h;
      used.add(h);
    }
  }
  if (!out.revenue) {
    const h = table.headers.find((x) => !used.has(x) && isNum(x));
    if (h) {
      out.revenue = h;
      used.add(h);
    }
  }
  if (!out.customer && out.customerName) {
    out.customer = out.customerName;
    delete out.customerName;
  }
  return out;
}

/** Missing required roles, in display order. */
export function missingRoles(mapping: PartialMapping): ColumnRole[] {
  return REQUIRED_ROLES.filter((r) => !mapping[r]);
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface UploadedDataset {
  rows: SalesRow[];
  /** Synthetic customer ID → the uploaded name (or original ID). Untrusted (I5). */
  customerNames: Record<string, string>;
  /** Rows skipped because a required value was empty. */
  skipped: number;
}

function safeSegment(raw: string): string {
  const s = raw.trim().replace(/\s+/g, " ");
  return SEGMENT_LABEL.test(s) ? s : "Other";
}

/**
 * Builds sales rows from uploaded records. Rows with an empty date, revenue or customer are
 * skipped and counted; a non-empty value that does not parse throws with its line number.
 */
export function rowsFromMapping(table: CsvTable, mapping: ColumnMapping): UploadedDataset {
  const m = ColumnMappingSchema.parse(mapping);
  for (const h of Object.values(m)) {
    if (h !== undefined && !table.headers.includes(h))
      throw new CsvUploadError(`The column "${h}" is not in the file.`);
  }

  const ids = new Map<string, string>();
  const customerNames: Record<string, string> = {};
  const segmentCounts = new Map<string, number>();
  const staged: Omit<SalesRow, "segment">[] = [];
  const segmentsRaw: string[] = [];
  let skipped = 0;

  table.records.forEach((rec, i) => {
    const line = i + 2;
    const rawDate = (rec[m.date] ?? "").trim();
    const rawRevenue = (rec[m.revenue] ?? "").trim();
    const rawCustomer = (rec[m.customer] ?? "").trim();
    if (!rawDate || !rawRevenue || !rawCustomer) {
      skipped += 1;
      return;
    }
    const date = parseDateValue(rawDate);
    if (!date) throw new CsvUploadError(`Line ${line}: "${m.date}" is not a date.`);
    const revenue = parseNumberValue(rawRevenue);
    if (revenue === null) throw new CsvUploadError(`Line ${line}: "${m.revenue}" is not a number.`);
    let cost = 0;
    if (m.cost && (rec[m.cost] ?? "").trim() !== "") {
      const c = parseNumberValue(rec[m.cost]);
      if (c === null) throw new CsvUploadError(`Line ${line}: "${m.cost}" is not a number.`);
      cost = c;
    }

    let customerId = ids.get(rawCustomer);
    if (!customerId) {
      customerId = `c${String(ids.size + 1).padStart(5, "0")}`;
      ids.set(rawCustomer, customerId);
      const name = m.customerName ? (rec[m.customerName] ?? "").trim() : "";
      customerNames[customerId] = name || rawCustomer;
    }
    const segment = m.segment ? safeSegment(rec[m.segment] ?? "") : "All customers";
    segmentCounts.set(segment, (segmentCounts.get(segment) ?? 0) + 1);
    segmentsRaw.push(segment);
    staged.push({
      orderId: (m.orderId ? (rec[m.orderId] ?? "").trim() : "") || `row-${line}`,
      date,
      customerId,
      customerName: customerNames[customerId] as string,
      revenue,
      cost,
    });
  });

  if (staged.length === 0) throw new CsvUploadError("No rows have a date, revenue and customer.");

  const kept = new Set(
    [...segmentCounts.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, MAX_SEGMENTS)
      .map(([s]) => s),
  );
  const rows: SalesRow[] = staged.map((r, i) => {
    const s = segmentsRaw[i] as string;
    return { ...r, segment: kept.has(s) ? s : "Other" };
  });
  return { rows, customerNames, skipped };
}
