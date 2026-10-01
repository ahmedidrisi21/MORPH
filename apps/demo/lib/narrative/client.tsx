"use client";
import type { Claim, Fact, NarrativeRecord } from "morph-core";
import { useMorph } from "morph-react";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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

/** The trace holds at most 20 drop reasons of 300 characters per slot. */
const clip = (reasons: string[]) => reasons.slice(0, 20).map((r) => String(r).slice(0, 300));

/**
 * Fetch verified claims for a slot; fall back to fact sentences on any failure (SPEC §12.6). What
 * happened (claims in and kept, why the rest were dropped, a failed request) is recorded on the
 * trace that produced the workspace, so the inspector and the stored traces can show how often the
 * AI text survives.
 */
export function useNarrative(
  slot: { slotId: string; factIds: string[] } | null,
  fallback: { text: string; factId: string }[],
): NarrativeState {
  const cfg = useContext(NarrativeCtx);
  const { morph, state: workspace } = useMorph();
  // The trace the workspace came from. Read through a ref so a new trace does not refetch.
  const traceId = useRef<string | null>(null);
  traceId.current = workspace?.traceId ?? null;
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
    const forTrace = traceId.current;
    const record = (r: Omit<NarrativeRecord, "slotId">) => {
      if (forTrace && !ac.signal.aborted)
        morph.recordNarrative(forTrace, { slotId: slot.slotId, ...r });
    };
    const failed = (why: string) => {
      record({ claimsIn: 0, claimsKept: 0, dropped: [why], source: "facts" });
      setState({ loading: false, source: "facts", claims: fallbackClaims });
    };
    setState({ loading: true, source: "facts", claims: fallbackClaims });
    fetch("/api/morph/narrate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotId: slot.slotId, intent: cfg.intent, facts: slotFacts }),
      signal: ac.signal,
    })
      .then((r) => {
        if (r.ok) return r.json();
        failed(`request failed (${r.status})`);
        return null;
      })
      .then(
        (
          body: {
            claims?: Claim[];
            source?: string;
            claimsIn?: number;
            claimsKept?: number;
            dropped?: string[];
          } | null,
        ) => {
          if (!body) return;
          const claims = body.claims ?? [];
          const ai = body.source === "ai" && claims.length > 0;
          record({
            claimsIn: body.claimsIn ?? 0,
            claimsKept: body.claimsKept ?? 0,
            dropped: clip(body.dropped ?? []),
            source: ai ? "ai" : "facts",
          });
          setState(
            ai
              ? { loading: false, source: "ai", claims }
              : { loading: false, source: "facts", claims: fallbackClaims },
          );
        },
      )
      .catch(() => {
        if (!ac.signal.aborted) failed("request failed");
      });
    return () => ac.abort();
  }, [cfg.enabled, cfg.intent, slotFacts, fallbackClaims, slot, morph]);

  return {
    ...state,
    factText: (id) => cfg.facts.find((f) => f.id === id)?.text ?? id,
  };
}
