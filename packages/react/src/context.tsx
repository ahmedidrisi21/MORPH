import type {
  DecisionTrace,
  LocalResult,
  Morph,
  MorphContext,
  MorphUIState,
  RingBufferSink,
  UIDiffOp,
} from "morph-core";
import { pushHistory, registryCompleteness } from "morph-core";
import {
  type ComponentType,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/** Props every renderer receives. `props` is already Zod-validated. */
export interface RendererProps<P = unknown> {
  props: P;
  id: string;
  instance: import("morph-core").ComponentInstance;
}

export type Renderers = Record<string, ComponentType<RendererProps<never>>>;

/** Everything in MorphContext that the app owns (the provider adds intent, ui and now). */
export type BaseContext = Pick<MorphContext, "user" | "facts"> &
  Partial<Pick<MorphContext, "untrusted">>;

export interface MorphReactValue {
  morph: Morph;
  renderers: Renderers;
  state: MorphUIState | null;
  lastTrace: DecisionTrace | null;
  lastDiff: UIDiffOp[];
  busy: boolean;
  history: string[];
  error: string | null;
  resolveIntent(intent: string): Promise<void>;
  override(leafId: string, via?: "alternate" | "clarify"): void;
  confirm(accepted: boolean): void;
  undo(): void;
  canUndo: boolean;
  /** Clarify: apply a filter to the current workspace (a local recompose). */
  inspectorOpen: boolean;
  setInspectorOpen(open: boolean): void;
  focusComponent: string | null;
  setFocusComponent(id: string | null): void;
  sink: RingBufferSink | null;
}

const Ctx = createContext<MorphReactValue | null>(null);

export interface MorphProviderProps {
  morph: Morph;
  renderers: Renderers;
  /** Base context (user, facts, untrusted); may be null while facts load. */
  context: BaseContext | null;
  initialState?: MorphUIState;
  clock?: () => number;
  children?: ReactNode;
}

export function MorphProvider({
  morph,
  renderers,
  context,
  initialState,
  clock = Date.now,
  children,
}: MorphProviderProps) {
  const problems = useMemo(
    () => registryCompleteness(morph.registry, Object.keys(renderers)),
    [morph, renderers],
  );
  if (problems.length) throw new Error(`MorphProvider: ${problems.join(" ")}`);

  const initialized = useRef(false);
  if (!initialized.current && initialState && !morph.getState()) {
    morph.setState(initialState);
  }
  initialized.current = true;

  const snapshot = useSyncExternalStore(
    useCallback((cb) => morph.subscribe(cb), [morph]),
    () => morph.getState(),
    () => morph.getState() ?? initialState ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [lastTrace, setLastTrace] = useState<DecisionTrace | null>(null);
  const [lastDiff, setLastDiff] = useState<UIDiffOp[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [focusComponent, setFocusComponent] = useState<string | null>(null);
  const [lastMorphAt, setLastMorphAt] = useState<number | null>(null);
  const [, force] = useState(0);

  useEffect(() => morph.subscribe(() => force((n) => n + 1)), [morph]);

  const buildContext = useCallback(
    (intent: string): MorphContext | null => {
      if (!context) return null;
      const state = morph.getState();
      const ctx: MorphContext = {
        intent: { raw: intent, history },
        user: context.user,
        facts: context.facts,
        ui: {
          workspaceId: state?.workspaceId ?? null,
          componentIds: state?.components.map((c) => c.id) ?? [],
          lastMorphAt,
          activeFilter: state?.filter ?? null,
        },
        now: clock(),
      };
      if (context.untrusted) ctx.untrusted = context.untrusted;
      if (typeof window !== "undefined")
        ctx.ui.viewport = { width: window.innerWidth, height: window.innerHeight };
      return ctx;
    },
    [context, morph, history, lastMorphAt, clock],
  );

  const resolveIntent = useCallback(
    async (intent: string) => {
      const text = intent.trim();
      if (!text) return;
      const ctx = buildContext(text);
      if (!ctx) return;
      setBusy(true);
      setError(null);
      try {
        const res = await morph.resolve(ctx, { trigger: "intent" });
        setLastTrace(res.trace);
        setLastDiff(res.diff);
        if (res.outcome.kind === "auto" || res.outcome.kind === "refine") setLastMorphAt(clock());
        setHistory((h) => pushHistory(h, text));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [buildContext, morph, clock],
  );

  const applyLocal = useCallback(
    (r: LocalResult | null) => {
      if (!r) return;
      setLastDiff(r.diff);
      setLastMorphAt(clock());
    },
    [clock],
  );

  const value: MorphReactValue = {
    morph,
    renderers,
    state: snapshot,
    lastTrace,
    lastDiff,
    busy,
    history,
    error,
    resolveIntent,
    override: (leafId, via = "alternate") => {
      const s = morph.getState();
      if (s) applyLocal(morph.override(s.traceId, leafId, via));
    },
    confirm: (accepted) => {
      const s = morph.getState();
      if (s) applyLocal(morph.confirm(s.traceId, accepted));
    },
    undo: () => applyLocal(morph.undo()),
    canUndo: morph.canUndo(),
    inspectorOpen,
    setInspectorOpen,
    focusComponent,
    setFocusComponent,
    sink: isRingBuffer(morph.sink) ? morph.sink : null,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function isRingBuffer(s: unknown): s is RingBufferSink {
  return typeof (s as { traces?: unknown }).traces === "function";
}

export function useMorphContext(): MorphReactValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMorph must be used inside <MorphProvider>.");
  return v;
}

/** Public hook (SPEC §11.6). */
export function useMorph() {
  const v = useMorphContext();
  return {
    state: v.state,
    pending: v.state?.pending ?? null,
    busy: v.busy,
    error: v.error,
    resolveIntent: v.resolveIntent,
    override: v.override,
    confirm: v.confirm,
    undo: v.undo,
    canUndo: v.canUndo,
    lastTrace: v.lastTrace,
    lastDiff: v.lastDiff,
    history: v.history,
    morph: v.morph,
  };
}
