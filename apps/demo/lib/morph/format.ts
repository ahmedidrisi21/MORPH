// Number formatting for component props. Formatting only; all math happens in the facts engine.
const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const fmtUsd = (n: number) => usd0.format(n);
export const fmtUsdCompact = (n: number) => usdCompact.format(n);
export const fmtInt = (n: number) => int.format(n);
export const fmtPct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
export const fmtMonth = (m: string) => {
  const [y, mo] = m.split("-");
  const names = [
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
  return `${names[Number(mo) - 1] ?? mo} ${y?.slice(2)}`;
};
