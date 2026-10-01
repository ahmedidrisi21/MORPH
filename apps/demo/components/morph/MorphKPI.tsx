"use client";
import type { RendererProps } from "morph-react";
import type { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { KpiProps } from "@/lib/morph/registry";
import { cn } from "@/lib/utils";

export function MorphKPI({ props }: RendererProps<z.infer<typeof KpiProps>>) {
  return (
    <Card size="sm" className="h-full">
      <CardHeader className="pr-20">
        <CardDescription>{props.label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums group-data-[size=sm]/card:text-2xl">
          {props.value}
        </CardTitle>
      </CardHeader>
      <CardContent className="gap-0">
        {props.delta ? (
          <span
            className={cn(
              "text-xs font-medium tabular-nums",
              props.tone === "down" && "text-rose-600",
              props.tone === "up" && "text-emerald-600",
              props.tone === "flat" && "text-slate-500",
            )}
          >
            {props.tone === "down" ? "▼" : props.tone === "up" ? "▲" : "•"} {props.delta}
          </span>
        ) : null}
        {props.caption ? <p className="mt-1 text-xs text-slate-500">{props.caption}</p> : null}
      </CardContent>
    </Card>
  );
}
