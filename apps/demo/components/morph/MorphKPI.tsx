"use client";
import {
  Activity,
  DollarSign,
  Minus,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import type { RendererProps } from "morph-react";
import type { ReactNode } from "react";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { KpiProps } from "@/lib/morph/registry";
import { cn } from "@/lib/utils";

function iconFor(label: string): ReactNode {
  if (/revenue|sales/i.test(label)) return <DollarSign />;
  if (/order/i.test(label)) return <ShoppingCart />;
  if (/profit|margin/i.test(label)) return <Wallet />;
  if (/customer/i.test(label)) return <Users />;
  return <Activity />;
}

const TONE = {
  up: { bar: "from-emerald-400 to-teal-400", pill: "bg-success/15 text-success", Icon: TrendingUp },
  down: {
    bar: "from-rose-500 to-orange-400",
    pill: "bg-danger/15 text-danger",
    Icon: TrendingDown,
  },
  flat: { bar: "from-violet-400 to-sky-400", pill: "bg-muted text-muted-foreground", Icon: Minus },
} as const;

export function MorphKPI({ props }: RendererProps<z.infer<typeof KpiProps>>) {
  const tone = TONE[props.tone];
  return (
    <Card
      size="sm"
      className="morph-rise relative h-full overflow-hidden transition-shadow hover:shadow-lg"
    >
      <div aria-hidden className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", tone.bar)} />
      <CardHeader className="pr-20">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="flex size-7 items-center justify-center rounded-lg bg-accent text-accent-foreground [&_svg]:size-4">
            {iconFor(props.label)}
          </span>
          {props.label}
        </div>
        <CardTitle className="mt-1 text-3xl font-semibold tracking-tight tabular-nums group-data-[size=sm]/card:text-3xl">
          {props.value}
        </CardTitle>
      </CardHeader>
      <CardContent className="gap-0">
        {props.delta ? (
          <Badge
            variant="secondary"
            className={cn("gap-1 rounded-full font-medium tabular-nums", tone.pill)}
          >
            <tone.Icon className="size-3.5" />
            {props.delta}
          </Badge>
        ) : null}
        {props.caption ? (
          <p className="mt-1.5 text-xs text-muted-foreground">{props.caption}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
