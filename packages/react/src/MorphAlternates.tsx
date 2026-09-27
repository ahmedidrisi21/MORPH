import { useMorphContext } from "./context";

/** Runner-up chips (local override, no network) plus undo. */
export function MorphAlternates() {
  const { state, override, undo, canUndo, busy } = useMorphContext();
  const alternates = state?.alternates ?? [];
  if (!alternates.length && !canUndo) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" aria-label="Alternate views">
      {alternates.length ? <span className="text-slate-500">Other views:</span> : null}
      {alternates.map((a) => (
        <button
          key={a.leafId}
          type="button"
          disabled={busy}
          data-alternate={a.leafId}
          onClick={() => override(a.leafId, "alternate")}
          className="rounded-full border border-slate-300 bg-white px-3 py-1 text-slate-700 hover:border-indigo-400 hover:text-indigo-700"
        >
          {a.title}
        </button>
      ))}
      {canUndo ? (
        <button
          type="button"
          disabled={busy}
          data-undo
          onClick={undo}
          className="rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-slate-700 hover:bg-slate-200"
        >
          ↶ Undo
        </button>
      ) : null}
    </div>
  );
}
