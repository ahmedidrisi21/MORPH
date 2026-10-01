"use client";
import type { RendererProps } from "morph-react";
import { useState } from "react";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { InsightProps } from "@/lib/morph/registry";
import { useNarrative } from "@/lib/narrative/client";

/**
 * Grounded insight slot. Shows verified AI claims when the narrative tier is on,
 * otherwise the facts' own code-generated sentences. Never blank.
 */
export function MorphInsight({ props, instance }: RendererProps<z.infer<typeof InsightProps>>) {
  const narrative = useNarrative(instance.narrativeSlot ?? null, props.fallback);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{props.title}</CardTitle>
        {narrative.source === "ai" ? <Badge variant="ai">AI-generated</Badge> : null}
      </CardHeader>
      <CardContent>
        {narrative.loading ? (
          <div className="flex flex-col gap-2" role="status" aria-label="Loading insight">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        ) : (
          <ul className="flex flex-col gap-2 text-sm" data-insight-source={narrative.source}>
            {narrative.claims.map((c) => (
              <li key={`${c.text}-${c.factIds.join()}`} className="leading-snug">
                {c.text}{" "}
                {narrative.source === "ai"
                  ? c.factIds.map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setOpen(open === id ? null : id)}
                        className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 align-middle text-[10px] text-slate-600 hover:bg-slate-200"
                        aria-label={`Source fact ${id}`}
                      >
                        {id}
                      </button>
                    ))
                  : null}
                {open && c.factIds.includes(open) ? (
                  <span className="mt-1 block rounded bg-slate-50 p-2 text-xs text-slate-600">
                    {narrative.factText(open)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
