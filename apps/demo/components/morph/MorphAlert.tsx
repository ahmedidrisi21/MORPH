"use client";
import { Info, TriangleAlert } from "lucide-react";
import type { RendererProps } from "morph-react";
import type { z } from "zod";
import type { AlertProps } from "@/lib/morph/registry";
import { cn } from "@/lib/utils";

export function MorphAlert({ props }: RendererProps<z.infer<typeof AlertProps>>) {
  const warning = props.tone === "warning";
  const Icon = warning ? TriangleAlert : Info;
  return (
    <div
      role="note"
      className={cn(
        "morph-rise flex items-start gap-2.5 rounded-xl border p-3 text-sm",
        warning
          ? "border-amber-400/40 bg-amber-400/10 text-amber-900 dark:text-amber-200"
          : "border-primary/25 bg-primary/8 text-foreground",
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", warning ? "text-amber-500" : "text-primary")} />
      <span>{props.text}</span>
    </div>
  );
}
