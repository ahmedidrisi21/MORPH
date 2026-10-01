"use client";
import { Sparkles } from "lucide-react";
import type { RendererProps } from "morph-react";
import { useState } from "react";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card size="sm" className="morph-rise h-full">
      <CardHeader className="pr-20">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          {props.title}
        </CardTitle>
        {narrative.source === "ai" ? (
          <CardAction>
            <Badge className="rounded-full border-0 bg-gradient-to-r from-violet-500 to-pink-500 text-white">
              AI-generated
            </Badge>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {narrative.loading ? (
          <div className="flex flex-col gap-2" role="status" aria-label="Loading insight">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        ) : (
          <ul className="flex flex-col gap-3 text-sm" data-insight-source={narrative.source}>
            {narrative.claims.map((c) => (
              <li
                key={`${c.text}-${c.factIds.join()}`}
                className="border-l-2 border-primary/40 pl-3 leading-snug"
              >
                {c.text}{" "}
                {narrative.source === "ai"
                  ? c.factIds.map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setOpen(open === id ? null : id)}
                        className="ml-1 rounded-full border bg-muted px-2 py-0.5 align-middle text-[10px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                        aria-label={`Source fact ${id}`}
                      >
                        {id}
                      </button>
                    ))
                  : null}
                {open && c.factIds.includes(open) ? (
                  <span className="mt-1.5 block rounded-lg bg-muted p-2 text-xs text-muted-foreground">
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
