"use client";
import type { RendererProps } from "morph-react";
import { useId } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ChartProps } from "@/lib/morph/registry";

// Series colours come from the theme (--chart-N), so light and dark both work.
const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];
const color = (i: number) => COLORS[i % COLORS.length] as string;
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

const tick = { fontSize: 11, fill: "var(--muted-foreground)" };
const tooltip = {
  contentStyle: {
    background: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    color: "var(--popover-foreground)",
    fontSize: 12,
    boxShadow: "0 12px 32px -12px oklch(0.2 0.05 280 / 0.35)",
  },
  cursor: { fill: "var(--muted)", opacity: 0.5 },
  formatter: (v: unknown) => (typeof v === "number" ? compact.format(v) : String(v)),
} as const;

export function MorphChart({ props }: RendererProps<z.infer<typeof ChartProps>>) {
  const highlight = new Set(props.highlight ?? []);
  const gid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const margin = { top: 8, right: 8, left: 0, bottom: 0 };
  const grid = <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="var(--border)" />;
  const xAxis = (
    <XAxis
      dataKey={props.xKey}
      tick={tick}
      tickLine={false}
      axisLine={false}
      minTickGap={16}
      tickMargin={8}
    />
  );
  const yAxis = (
    <YAxis
      tick={tick}
      tickLine={false}
      axisLine={false}
      tickFormatter={(v: number) => compact.format(v)}
      width={44}
    />
  );
  const legend = props.series.length > 1 ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null;
  const gradients = (
    <defs>
      {props.series.map((s, i) => (
        <linearGradient key={s.key} id={`${gid}-${i}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: color(i), stopOpacity: 0.55 }} />
          <stop offset="100%" style={{ stopColor: color(i), stopOpacity: 0.02 }} />
        </linearGradient>
      ))}
      <linearGradient id={`${gid}-hi`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" style={{ stopColor: "var(--danger)", stopOpacity: 1 }} />
        <stop offset="100%" style={{ stopColor: "var(--danger)", stopOpacity: 0.55 }} />
      </linearGradient>
    </defs>
  );

  return (
    <Card size="sm" className="morph-rise h-full">
      <CardHeader className="pr-20">
        <CardTitle>{props.title}</CardTitle>
        {props.caption ? <CardDescription>{props.caption}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <div className="h-60 w-full" role="img" aria-label={props.title}>
          <ResponsiveContainer width="100%" height="100%">
            {props.kind === "line" ? (
              props.series.length === 1 ? (
                <AreaChart data={props.data} margin={margin}>
                  {gradients}
                  {grid}
                  {xAxis}
                  {yAxis}
                  <Tooltip {...tooltip} />
                  {props.series.map((s, i) => (
                    <Area
                      key={s.key}
                      type="monotone"
                      dataKey={s.key}
                      name={s.label}
                      stroke={color(i)}
                      strokeWidth={2.5}
                      fill={`url(#${gid}-${i})`}
                      dot={false}
                      activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
                      isAnimationActive={false}
                    />
                  ))}
                </AreaChart>
              ) : (
                <LineChart data={props.data} margin={margin}>
                  {grid}
                  {xAxis}
                  {yAxis}
                  <Tooltip {...tooltip} />
                  {legend}
                  {props.series.map((s, i) => (
                    <Line
                      key={s.key}
                      type="monotone"
                      dataKey={s.key}
                      name={s.label}
                      stroke={color(i)}
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              )
            ) : (
              <BarChart data={props.data} margin={margin} barCategoryGap="18%">
                {gradients}
                {grid}
                {xAxis}
                {yAxis}
                <Tooltip {...tooltip} />
                {legend}
                {props.series.map((s, i) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    name={s.label}
                    fill={props.series.length === 1 ? `url(#${gid}-${i})` : color(i)}
                    stroke={props.series.length === 1 ? color(i) : undefined}
                    strokeWidth={props.series.length === 1 ? 1 : 0}
                    radius={[6, 6, 0, 0]}
                    isAnimationActive={false}
                  >
                    {props.series.length === 1
                      ? props.data.map((d) => {
                          const hot = highlight.has(String(d[props.xKey]));
                          return (
                            <Cell
                              key={String(d[props.xKey])}
                              fill={hot ? `url(#${gid}-hi)` : `url(#${gid}-${i})`}
                              stroke={hot ? "var(--danger)" : color(i)}
                            />
                          );
                        })
                      : null}
                  </Bar>
                ))}
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
