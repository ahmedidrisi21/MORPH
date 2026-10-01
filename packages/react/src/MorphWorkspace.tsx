import type { ComponentInstance, Slot } from "morph-core";
import { AnimatePresence, motion } from "motion/react";
import { useMorphContext } from "./context";
import { MorphPending } from "./MorphPending";
import { MorphRenderer } from "./MorphRenderer";

const SLOTS: Slot[] = ["header", "main", "side", "footer"];

/** Layout inside a slot. The slot's width in the page grid is set by `slotSpan`. */
const slotClass: Record<Slot, string> = {
  header: "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4",
  main: "grid grid-cols-1 gap-4",
  side: "grid grid-cols-1 gap-4 content-start",
  footer: "grid grid-cols-1 gap-3 sm:grid-cols-2",
};

/** Columns a slot takes on large screens: main fills the row when there is no side column. */
function slotSpan(slot: Slot, hasSide: boolean): string {
  if (slot === "header" || slot === "footer") return "lg:col-span-3";
  if (slot === "main") return hasSide ? "lg:col-span-2" : "lg:col-span-3";
  return "";
}

export interface MorphWorkspaceProps {
  /** Optional wrapper for each component (e.g. a "Why this?" affordance). */
  renderFrame?: (instance: ComponentInstance, child: React.ReactNode) => React.ReactNode;
  emptyText?: string;
}

/** Renders the current MorphUIState. Components are keyed by stable id so adds, removes and moves animate. */
export function MorphWorkspace({
  renderFrame,
  emptyText = "Nothing to show yet.",
}: MorphWorkspaceProps) {
  const { state, busy } = useMorphContext();
  if (!state) return <p className="text-sm text-slate-500">{emptyText}</p>;
  const bySlot = (slot: Slot) => state.components.filter((c) => c.slot === slot);
  return (
    <section
      aria-busy={busy}
      data-workspace={state.workspaceId}
      data-filter={state.filter ?? ""}
      className="flex flex-col gap-4"
    >
      <MorphPending />
      <motion.h2
        layout
        key={state.title}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-lg font-semibold text-slate-900"
      >
        {state.title}
        {state.filter ? (
          <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 align-middle text-xs font-medium text-indigo-700">
            filter: {state.filter.replace(/_/g, " ")}
          </span>
        ) : null}
      </motion.h2>
      <div
        className={`grid grid-cols-1 gap-4 lg:grid-cols-3 transition-opacity ${busy ? "opacity-60" : "opacity-100"}`}
      >
        {SLOTS.map((slot) => {
          const items = bySlot(slot);
          if (items.length === 0) return null;
          return (
            <div key={slot} data-slot={slot} className={slotSpan(slot, bySlot("side").length > 0)}>
              <div className={slotClass[slot]}>
                <AnimatePresence mode="popLayout" initial={false}>
                  {items.map((c) => (
                    <motion.div
                      key={c.id}
                      layout
                      data-component={c.id}
                      initial={{ opacity: 0, scale: 0.97, y: 8 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.97 }}
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                      className="min-w-0"
                    >
                      {renderFrame ? (
                        renderFrame(c, <MorphRenderer instance={c} />)
                      ) : (
                        <MorphRenderer instance={c} />
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
