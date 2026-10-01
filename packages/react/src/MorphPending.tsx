import { AnimatePresence, motion } from "motion/react";
import { useMorphContext } from "./context";

/** Confirm / clarify / alternates banners for a pending gate outcome. */
export function MorphPending() {
  const { state, confirm, override, resolveIntent, busy } = useMorphContext();
  const pending = state?.pending ?? null;
  return (
    <AnimatePresence initial={false}>
      {pending ? (
        <motion.div
          key={`${state?.traceId}-${pending.kind}`}
          role="status"
          data-pending={pending.kind}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          {pending.kind === "confirm" ? (
            <div className="flex flex-wrap items-center gap-2">
              <span>Show {pending.options[0]?.title}?</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => confirm(true)}
                className="rounded-md bg-amber-600 px-3 py-1 font-medium text-white hover:bg-amber-700"
              >
                Yes
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => confirm(false)}
                className="rounded-md border border-amber-400 px-3 py-1 hover:bg-amber-100"
              >
                No
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span>
                {pending.kind === "alternates" ? "Two views fit. Pick one:" : "Did you mean…"}
              </span>
              {pending.options.map((o) => (
                <button
                  key={o.leafId}
                  type="button"
                  data-option={o.leafId}
                  onClick={() =>
                    override(o.leafId, pending.kind === "alternates" ? "alternate" : "clarify")
                  }
                  className="rounded-md border border-amber-400 bg-white px-3 py-1 hover:bg-amber-100"
                >
                  {o.title}
                </button>
              ))}
              {(pending.filters ?? []).map((f) => (
                <button
                  key={f}
                  type="button"
                  data-filter-option={f}
                  onClick={() => void resolveIntent(`Only show ${f.replace(/_/g, " ")} items`)}
                  className="rounded-md border border-amber-400 bg-white px-3 py-1 hover:bg-amber-100"
                >
                  only {f.replace(/_/g, " ")}
                </button>
              ))}
              {pending.kind === "clarify" ? (
                <span className="text-amber-700">or try asking another way.</span>
              ) : null}
            </div>
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
