"use client";
import { CalendarClock, Download, Mail, Percent } from "lucide-react";
import type { RendererProps } from "morph-react";
import type { ReactNode } from "react";
import { useState } from "react";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ActionProps } from "@/lib/morph/registry";
import { actions as registered } from "@/lib/morph/registry";

const ICON: Record<string, ReactNode> = {
  email_customers: <Mail />,
  schedule_calls: <CalendarClock />,
  export_list: <Download />,
  offer_discount: <Percent />,
};
const RISK_LABEL = {
  low: "Low risk",
  medium: "Needs a look",
  high: "High risk",
  critical: "Asks first",
};

export function MorphAction({ props }: RendererProps<z.infer<typeof ActionProps>>) {
  const [done, setDone] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <Card size="sm" className="morph-rise">
      <CardHeader className="pr-20">
        <CardTitle>{props.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {props.actions.map((a) => {
          const def = registered.find((r) => r.id === a.actionId);
          const critical = def?.risk === "critical";
          return (
            <div
              key={a.actionId}
              className="flex flex-col gap-3 rounded-xl border bg-card p-3 transition-all hover:border-primary/50 hover:shadow-md sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground [&_svg]:size-4">
                  {ICON[a.actionId]}
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {a.label}
                    {def ? (
                      <Badge
                        variant="outline"
                        className={
                          def.risk === "critical" || def.risk === "high"
                            ? "border-danger/40 text-danger"
                            : "text-muted-foreground"
                        }
                      >
                        {RISK_LABEL[def.risk]}
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">{a.description}</p>
                </div>
              </div>
              {confirming === a.actionId ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      setDone(a.actionId);
                      setConfirming(null);
                    }}
                  >
                    Confirm
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setConfirming(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  className="shrink-0 whitespace-nowrap"
                  variant={done === a.actionId ? "ghost" : "outline"}
                  data-action={a.actionId}
                  onClick={() => (critical ? setConfirming(a.actionId) : setDone(a.actionId))}
                >
                  {done === a.actionId ? "Queued (demo)" : critical ? "Review…" : "Do it"}
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
