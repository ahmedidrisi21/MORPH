import Papa from "papaparse";
import { z } from "zod";

export const SalesRowSchema = z.object({
  orderId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  customerId: z.string().min(1),
  /** Dataset string: untrusted (I5). Never put it in a fact, lens or policy input. */
  customerName: z.string(),
  segment: z.string().min(1),
  revenue: z.number(),
  profit: z.number(),
});
export type SalesRow = z.infer<typeof SalesRowSchema>;

const CsvRecordSchema = z
  .object({
    order_id: z.string(),
    date: z.string(),
    customer_id: z.string(),
    customer_name: z.string(),
    segment: z.string(),
    revenue: z.coerce.number(),
    profit: z.coerce.number(),
  })
  .transform((r) => ({
    orderId: r.order_id,
    date: r.date,
    customerId: r.customer_id,
    customerName: r.customer_name,
    segment: r.segment,
    revenue: r.revenue,
    profit: r.profit,
  }))
  .pipe(SalesRowSchema);

/** Parses `data/sales.csv`. Throws on the first malformed row, naming its line. */
export function parseSalesCsv(text: string): SalesRow[] {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  const first = parsed.errors[0];
  if (first) throw new Error(`sales.csv row ${first.row ?? "?"}: ${first.message}`);
  return parsed.data.map((record, i) => {
    const res = CsvRecordSchema.safeParse(record);
    if (!res.success) {
      throw new Error(`sales.csv line ${i + 2}: ${res.error.issues[0]?.message ?? "invalid row"}`);
    }
    return res.data;
  });
}
