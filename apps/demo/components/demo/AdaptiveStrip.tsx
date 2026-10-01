"use client";
import { useMorph } from "morph-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const OUTCOME: Record<string, string> = {
  auto: "Switched on its own",
  confirm: "Asked first",
  alternates: "Offered two views",
  clarify: "Needs a hint",
  refine: "Filtered this view",
  stay: "Stayed put",
};

/** Shows the dashboard adapting: what it is showing, and how sure it was about the last change. */
export function AdaptiveStrip() {
  const { state, busy, lastTrace } = useMorph();
  const gate = lastTrace?.gate;
  const confidence = gate?.confidence;
  const pct = typeof confidence === "number" ? Math.round(confidence * 100) : null;
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border bg-card/70 px-4 py-2.5 text-sm backdrop-blur"
      data-adaptive-strip
    >
      <span className="flex items-center gap-2 font-medium">
        <span
          aria-hidden
          className={cn(
            "size-2.5 rounded-full",
            busy ? "animate-pulse bg-amber-500" : "morph-live bg-success",
          )}
        />
        {busy ? "Adapting…" : "Live"}
      </span>
      <span className="min-w-0 truncate text-muted-foreground">
        Showing <span className="font-medium text-foreground">{state?.title ?? "…"}</span>
      </span>
      {gate ? (
        <span className="ml-auto flex items-center gap-2">
          <Badge variant="secondary">{OUTCOME[gate.outcome.kind] ?? gate.outcome.kind}</Badge>
          {pct !== null ? (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                role="progressbar"
                aria-label="Confidence"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"
              >
                <span
                  className="block h-full rounded-full bg-gradient-to-r from-violet-500 to-pink-500"
                  style={{ width: `${pct}%` }}
                />
              </span>
              <span className="tabular-nums">{pct}% sure</span>
            </span>
          ) : null}
        </span>
      ) : (
        <span className="ml-auto text-xs text-muted-foreground">
          Ask a question and watch it reshape.
        </span>
      )}
    </div>
  );
}
