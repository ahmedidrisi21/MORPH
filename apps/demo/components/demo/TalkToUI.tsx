"use client";
import { type MorphUIState, RemoteProvider, RingBufferSink } from "@morph/core";
import {
  type BaseContext,
  MorphAlternates,
  MorphInspector,
  MorphIntentBar,
  MorphProvider,
  MorphWhyThis,
  MorphWorkspace,
  useMorph,
} from "@morph/react";
import { useEffect, useMemo, useState } from "react";
import { renderers } from "@/components/morph/renderers";
import { Skeleton } from "@/components/ui/skeleton";
import { customerNames, parseSalesCsv, type SalesFacts, tsFactsEngine } from "@/lib/facts";
import { createDemoMorph, DEMO_USER } from "@/lib/morph";
import { NarrativeProvider } from "@/lib/narrative/client";

export const DEMO_SUGGESTIONS = [
  "Why did revenue fall?",
  "Show me the customers.",
  "Only show customers I can save.",
  "What should I do?",
];

interface Loaded {
  context: BaseContext;
  initial: MorphUIState;
  factsMs: number;
}

export function TalkToUI({ narrativeEnabled }: { narrativeEnabled: boolean }) {
  const sink = useMemo(() => new RingBufferSink(), []);
  const morph = useMemo(
    () =>
      createDemoMorph({
        // Only lens states leave the browser; keys stay on the server (I4, I8).
        provider: new RemoteProvider({ url: "/api/morph/decide" }),
        traceSink: sink,
        lensBudget: process.env.NODE_ENV === "production" ? "warn" : "throw",
      }),
    [sink],
  );
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t0 = performance.now();
    fetch("/data/sales.csv")
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load the demo data (${r.status}).`);
        return r.text();
      })
      .then((text) => {
        if (cancelled) return;
        const rows = parseSalesCsv(text);
        const facts: SalesFacts = tsFactsEngine.computeSync(rows);
        // Customer names are dataset strings: untrusted, never in a lens, never read by policy (I5).
        const context: BaseContext = {
          user: DEMO_USER,
          facts,
          untrusted: { customerNames: customerNames(rows) },
        };
        const initial = morph.composeLeaf("overview.default", {
          ...context,
          intent: { raw: "", history: [] },
          ui: { workspaceId: null, componentIds: [], lastMorphAt: null, activeFilter: null },
          now: Date.now(),
        });
        morph.setState(initial);
        setLoaded({ context, initial, factsMs: Math.round(performance.now() - t0) });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [morph]);

  if (error)
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>
    );
  if (!loaded) return <LoadingWorkspace />;

  return (
    <MorphProvider
      morph={morph}
      renderers={renderers}
      context={loaded.context}
      initialState={loaded.initial}
    >
      <Shell narrativeEnabled={narrativeEnabled} facts={loaded.context.facts as SalesFacts} />
    </MorphProvider>
  );
}

function Shell({ narrativeEnabled, facts }: { narrativeEnabled: boolean; facts: SalesFacts }) {
  const { history } = useMorph();
  const narrative = useMemo(
    () => ({
      enabled: narrativeEnabled,
      intent: history[history.length - 1] ?? "",
      facts: facts.items,
    }),
    [narrativeEnabled, history, facts],
  );
  return (
    <NarrativeProvider value={narrative}>
      <div className="flex flex-col gap-4">
        <div className="sticky top-0 z-10 -mx-4 flex flex-col gap-2 border-b border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <MorphIntentBar
            suggestions={DEMO_SUGGESTIONS}
            placeholder="Ask about sales, e.g. “Why did revenue fall?”"
          />
          <MorphAlternates />
        </div>
        <MorphWorkspace
          renderFrame={(instance, child) => (
            <MorphWhyThis componentId={instance.id}>{child}</MorphWhyThis>
          )}
        />
        <MorphInspector />
      </div>
    </NarrativeProvider>
  );
}

function LoadingWorkspace() {
  return (
    <div
      className="flex flex-col gap-4"
      role="status"
      aria-busy="true"
      aria-label="Loading the demo"
    >
      <Skeleton className="h-10 w-full" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
