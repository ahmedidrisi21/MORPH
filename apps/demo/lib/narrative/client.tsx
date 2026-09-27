"use client";
import type { Claim, Fact } from "@morph/core";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

export interface NarrativeConfig {
  /** Narrative tier enabled on the server (MORPH_NARRATIVE_PROVIDER != none). */
  enabled: boolean;
  intent: string;
  facts: Fact[];
}

const NarrativeCtx = createContext<NarrativeConfig>({ enabled: false, intent: "", facts: [] });

export function NarrativeProvider({
  value,
  children,
}: {
  value: NarrativeConfig;
  children: ReactNode;
}) {
  return <NarrativeCtx.Provider value={value}>{children}</NarrativeCtx.Provider>;
}

export interface NarrativeState {
  loading: boolean;
  source: "ai" | "facts";
  claims: Claim[];
  factText(id: string): string;
}

/** Fetch verified claims for a slot; fall back to fact sentences on any failure (SPEC §12.6). */
export function useNarrative(
  slot: { slotId: string; factIds: string[] } | null,
  fallback: { text: string; factId: string }[],
): NarrativeState {
  const cfg = useContext(NarrativeCtx);
  const fallbackClaims = useMemo(
    () => fallback.map((f) => ({ text: f.text, factIds: [f.factId] })),
    [fallback],
  );
  const [state, setState] = useState<{ loading: boolean; source: "ai" | "facts"; claims: Claim[] }>(
    {
      loading: false,
      source: "facts",
      claims: fallbackClaims,
    },
  );
  const slotFacts = useMemo(
    () => (slot ? cfg.facts.filter((f) => slot.factIds.includes(f.id)) : []),
    [slot, cfg.facts],
  );

  useEffect(() => {
    if (!cfg.enabled || !slot || slotFacts.length === 0) {
      setState({ loading: false, source: "facts", claims: fallbackClaims });
      return;
    }
    const ac = new AbortController();
    setState({ loading: true, source: "facts", claims: fallbackClaims });
    fetch("/api/morph/narrate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotId: slot.slotId, intent: cfg.intent, facts: slotFacts }),
      signal: ac.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { claims?: Claim[]; source?: string } | null) => {
        const claims = body?.claims ?? [];
        if (body?.source === "ai" && claims.length > 0)
          setState({ loading: false, source: "ai", claims });
        else setState({ loading: false, source: "facts", claims: fallbackClaims });
      })
      .catch(() => {
        if (!ac.signal.aborted)
          setState({ loading: false, source: "facts", claims: fallbackClaims });
      });
    return () => ac.abort();
  }, [cfg.enabled, cfg.intent, slotFacts, fallbackClaims, slot]);

  return {
    ...state,
    factText: (id) => cfg.facts.find((f) => f.id === id)?.text ?? id,
  };
}
