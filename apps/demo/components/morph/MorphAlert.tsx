"use client";
import type { RendererProps } from "@morph/react";
import type { z } from "zod";
import type { AlertProps } from "@/lib/morph/registry";
import { cn } from "@/lib/utils";

export function MorphAlert({ props }: RendererProps<z.infer<typeof AlertProps>>) {
  return (
    <div
      role="note"
      className={cn(
        "rounded-lg border p-3 text-sm",
        props.tone === "warning"
          ? "border-amber-300 bg-amber-50 text-amber-900"
          : "border-sky-200 bg-sky-50 text-sky-900",
      )}
    >
      {props.text}
    </div>
  );
}
