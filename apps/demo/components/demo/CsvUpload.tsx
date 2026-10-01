"use client";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  COLUMN_ROLES,
  type ColumnMapping,
  type ColumnRole,
  type CsvTable,
  CsvUploadError,
  MAX_UPLOAD_BYTES,
  missingRoles,
  type PartialMapping,
  REQUIRED_ROLES,
  ROLE_LABEL,
  readCsvTable,
  rowsFromMapping,
  suggestMapping,
  type UploadedDataset,
} from "@/lib/facts";

export interface UploadResult extends UploadedDataset {
  fileName: string;
}

const REQUIRED = new Set<ColumnRole>(REQUIRED_ROLES);

/**
 * "Use your own CSV": picks a file, suggests which column is which, and hands parsed rows to
 * `onLoad`. The file is parsed in the browser and its rows are never uploaded. With the narrative
 * tier on, summary figures computed from them do go to the server (`summariesLeaveBrowser`).
 */
export function CsvUpload({
  onLoad,
  onReset,
  current,
  summariesLeaveBrowser = false,
}: {
  onLoad: (result: UploadResult) => void;
  onReset: () => void;
  /** File name of the loaded upload, or null while the demo data is shown. */
  current: string | null;
  /** The narrative tier is on, so figures derived from the rows are sent to the AI writer. */
  summariesLeaveBrowser?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<{
    fileName: string;
    table: CsvTable;
    mapping: PartialMapping;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idBase = useId();

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      if (file.size > MAX_UPLOAD_BYTES) throw new CsvUploadError("The file is larger than 20 MB.");
      const table = readCsvTable(await file.text());
      setDraft({ fileName: file.name, table, mapping: suggestMapping(table) });
    } catch (e) {
      setDraft(null);
      setError(e instanceof CsvUploadError ? e.message : "Could not read that file as CSV.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function build() {
    if (!draft) return;
    setError(null);
    try {
      const result = rowsFromMapping(draft.table, draft.mapping as ColumnMapping);
      onLoad({ ...result, fileName: draft.fileName });
      setDraft(null);
    } catch (e) {
      setError(e instanceof CsvUploadError ? e.message : "Could not build a dashboard from it.");
    }
  }

  const missing = draft ? missingRoles(draft.mapping) : [];

  return (
    <div className="flex flex-col gap-2" data-csv-upload>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          id={`${idBase}-file`}
          data-csv-input
          onChange={(e) => void pick(e.target.files?.[0])}
        />
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          Use your own CSV
        </Button>
        {current ? (
          <>
            <span className="truncate text-slate-600" data-csv-current>
              Showing {current}
            </span>
            <Button variant="ghost" size="sm" onClick={onReset}>
              Back to demo data
            </Button>
          </>
        ) : null}
        {!current || summariesLeaveBrowser ? (
          <span className="text-slate-500" data-csv-privacy>
            {summariesLeaveBrowser
              ? "Your rows stay in your browser. Summary figures are sent to the AI writer."
              : "Stays in your browser."}
          </span>
        ) : null}
      </div>

      {error && (
        <p
          className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      )}

      {draft && (
        <section
          className="rounded-lg border border-slate-200 bg-white p-3"
          aria-label="Match your columns"
          data-csv-mapping
        >
          <p className="mb-2 text-sm text-slate-700">
            Check which column is which in <span className="font-medium">{draft.fileName}</span> (
            {draft.table.records.length.toLocaleString()} rows).
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {COLUMN_ROLES.map((role) => (
              <label key={role} className="flex flex-col gap-1 text-xs text-slate-600">
                <span>
                  {ROLE_LABEL[role]}
                  {REQUIRED.has(role) ? " (required)" : ""}
                </span>
                <select
                  className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800"
                  data-role={role}
                  value={draft.mapping[role] ?? ""}
                  onChange={(e) => {
                    const mapping = { ...draft.mapping };
                    if (e.target.value) mapping[role] = e.target.value;
                    else delete mapping[role];
                    setDraft({ ...draft, mapping });
                  }}
                >
                  <option value="">{REQUIRED.has(role) ? "Choose a column" : "None"}</option>
                  {draft.table.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={build} disabled={missing.length > 0} data-csv-build>
              Build dashboard
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            {missing.length > 0 && (
              <span className="text-xs text-slate-500">
                Choose: {missing.map((r) => ROLE_LABEL[r]).join(", ")}
              </span>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
