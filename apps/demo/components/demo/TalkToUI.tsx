"use client";
import { batchingSink, httpTraceSend, RemoteProvider, RingBufferSink } from "@morph/core";
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
import { useCallback, useEffect, useMemo, useState } from "react";
import { renderers } from "@/components/morph/renderers";
import { Skeleton } from "@/components/ui/skeleton";
import {
  computeSalesFacts,
  customerNames,
  parseSalesCsv,
  type SalesFacts,
  tsFactsEngine,
} from "@/lib/facts";
import { createDemoMorph, DEMO_USER } from "@/lib/morph";
import { NarrativeProvider } from "@/lib/narrative/client";
import { CsvUpload, type UploadResult } from "./CsvUpload";

export const DEMO_SUGGESTIONS = [
  "Why did revenue fall?",
  "Show me the customers.",
  "Only show customers I can save.",
  "What should I do?",
];

interface Dataset {
  /** Changes whenever the data changes, so the workspace starts fresh. */
  key: string;
  /** File name of an uploaded CSV; null for the demo data. */
  upload: string | null;
  context: BaseContext;
  factsMs: number;
}

export function TalkToUI({
  narrativeEnabled,
  saveTraces = false,
}: {
  narrativeEnabled: boolean;
  /** Also send traces to /api/morph/traces (the server has MORPH_TRACE_DIR set). */
  saveTraces?: boolean;
}) {
  const [demo, setDemo] = useState<Dataset | null>(null);
  const [upload, setUpload] = useState<Dataset | null>(null);
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
        setDemo({
          key: "demo",
          upload: null,
          context: { user: DEMO_USER, facts, untrusted: { customerNames: customerNames(rows) } },
          factsMs: Math.round(performance.now() - t0),
        });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const onUpload = useCallback((result: UploadResult) => {
    const t0 = performance.now();
    const facts: SalesFacts = computeSalesFacts(result.rows, "upload");
    setUpload((prev) => ({
      key: `upload-${prev ? Number(prev.key.slice(7)) + 1 : 1}`,
      upload: result.fileName,
      // Uploaded names are untrusted like the demo's; the rows never leave the browser (I4, I5).
      context: { user: DEMO_USER, facts, untrusted: { customerNames: result.customerNames } },
      factsMs: Math.round(performance.now() - t0),
    }));
  }, []);

  if (error)
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>
    );
  const dataset = upload ?? demo;
  if (!dataset) return <LoadingWorkspace />;

  return (
    <div className="flex flex-col gap-3">
      <CsvUpload
        current={upload?.upload ?? null}
        onLoad={onUpload}
        onReset={() => setUpload(null)}
      />
      <Workspace
        key={dataset.key}
        dataset={dataset}
        narrativeEnabled={narrativeEnabled}
        saveTraces={saveTraces}
      />
    </div>
  );
}

function Workspace({
  dataset,
  narrativeEnabled,
  saveTraces,
}: {
  dataset: Dataset;
  narrativeEnabled: boolean;
  saveTraces: boolean;
}) {
  const store = useMemo(
    () => (saveTraces ? batchingSink({ send: httpTraceSend("/api/morph/traces") }) : null),
    [saveTraces],
  );
  const sink = useMemo(() => new RingBufferSink(store ? { forward: store } : {}), [store]);
  // Send what is pending when the tab is hidden or the dataset changes.
  useEffect(() => {
    if (!store) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") void store.flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void store.flush();
    };
  }, [store]);
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
  const initial = useMemo(() => {
    const state = morph.composeLeaf("overview.default", {
      ...dataset.context,
      intent: { raw: "", history: [] },
      ui: { workspaceId: null, componentIds: [], lastMorphAt: null, activeFilter: null },
      now: Date.now(),
    });
    morph.setState(state);
    return state;
  }, [morph, dataset]);

  return (
    <MorphProvider
      morph={morph}
      renderers={renderers}
      context={dataset.context}
      initialState={initial}
    >
      <Shell narrativeEnabled={narrativeEnabled} facts={dataset.context.facts as SalesFacts} />
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
