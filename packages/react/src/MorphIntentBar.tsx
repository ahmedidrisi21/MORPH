import { type FormEvent, useState } from "react";
import { useMorphContext } from "./context";

export interface MorphIntentBarProps {
  suggestions?: string[];
  placeholder?: string;
}

/** Text input + suggestion chips → resolveIntent. */
export function MorphIntentBar({
  suggestions = [],
  placeholder = "Ask about your data…",
}: MorphIntentBarProps) {
  const { resolveIntent, busy } = useMorphContext();
  const [text, setText] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text;
    setText("");
    void resolveIntent(t);
  };
  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor="morph-intent" className="sr-only">
          Ask MORPH
        </label>
        <input
          id="morph-intent"
          name="intent"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? "Thinking…" : "Ask"}
        </button>
      </form>
      {suggestions.length ? (
        <div className="flex flex-wrap gap-2" aria-label="Suggestions">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              disabled={busy}
              data-suggestion={s}
              onClick={() => void resolveIntent(s)}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:border-indigo-400 hover:text-indigo-700 disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
