"use client";
import type { RendererProps } from "morph-react";
import {
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

const COLORS = ["#4f46e5", "#94a3b8", "#0ea5e9", "#f59e0b"];
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function MorphChart({ props }: RendererProps<z.infer<typeof ChartProps>>) {
  const highlight = new Set(props.highlight ?? []);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        {props.caption ? <CardDescription>{props.caption}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <div className="h-56 w-full" role="img" aria-label={props.title}>
          <ResponsiveContainer width="100%" height="100%">
            {props.kind === "line" ? (
              <LineChart data={props.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey={props.xKey} tick={{ fontSize: 11 }} minTickGap={16} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: number) => compact.format(v)}
                  width={44}
                />
                <Tooltip
                  formatter={(v) => (typeof v === "number" ? compact.format(v) : String(v))}
                />
                {props.series.length > 1 ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
                {props.series.map((s, i) => (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.label}
                    stroke={COLORS[i % COLORS.length] as string}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            ) : (
              <BarChart data={props.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey={props.xKey} tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: number) => compact.format(v)}
                  width={44}
                />
                <Tooltip
                  formatter={(v) => (typeof v === "number" ? compact.format(v) : String(v))}
                />
                {props.series.length > 1 ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
                {props.series.map((s, i) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    name={s.label}
                    fill={COLORS[i % COLORS.length] as string}
                    isAnimationActive={false}
                  >
                    {props.series.length === 1
                      ? props.data.map((d) => (
                          <Cell
                            key={String(d[props.xKey])}
                            fill={
                              highlight.has(String(d[props.xKey]))
                                ? "#e11d48"
                                : (COLORS[i % COLORS.length] as string)
                            }
                          />
                        ))
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
