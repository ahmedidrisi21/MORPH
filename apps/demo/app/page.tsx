import { TalkToUI } from "@/components/demo/TalkToUI";
import { traceLensEnabled, traceStorageEnabled } from "@/lib/server/traces";

export default function Page() {
  // Server component: reads env on the server and passes only a boolean to the client.
  const narrativeEnabled = (process.env.MORPH_NARRATIVE_PROVIDER ?? "none") !== "none";
  const saveTraces = traceStorageEnabled(process.env);
  const saveLens = traceLensEnabled(process.env);
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
      <header className="pt-6 pb-2">
        <h1 className="text-xl font-semibold text-slate-900">MORPH</h1>
        <p className="text-sm text-slate-600">
          Ask a question. The workspace reshapes itself to answer it.
        </p>
      </header>
      <TalkToUI narrativeEnabled={narrativeEnabled} saveTraces={saveTraces} saveLens={saveLens} />
    </main>
  );
}
