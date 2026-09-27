"use client";
import type { RendererProps } from "@morph/react";
import { useState } from "react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ActionProps } from "@/lib/morph/registry";
import { actions as registered } from "@/lib/morph/registry";

export function MorphAction({ props }: RendererProps<z.infer<typeof ActionProps>>) {
  const [done, setDone] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {props.actions.map((a) => {
          const def = registered.find((r) => r.id === a.actionId);
          const critical = def?.risk === "critical";
          return (
            <div
              key={a.actionId}
              className="flex flex-col gap-2 rounded-lg border border-slate-100 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{a.label}</p>
                <p className="text-xs text-slate-500">{a.description}</p>
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
