import { Sparkles } from "lucide-react";
import { ShareButton } from "@/components/demo/ShareButton";
import { TalkToUI } from "@/components/demo/TalkToUI";
import { ThemeToggle } from "@/components/demo/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { traceLensEnabled, traceStorageEnabled } from "@/lib/server/traces";

export default function Page() {
  // Server component: reads env on the server and passes only a boolean to the client.
  const narrativeEnabled = (process.env.MORPH_NARRATIVE_PROVIDER ?? "none") !== "none";
  const saveTraces = traceStorageEnabled(process.env);
  const saveLens = traceLensEnabled(process.env);
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6">
      <header className="flex flex-col gap-4 pt-8 pb-4">
        <div className="flex items-center justify-between gap-3">
          <Badge variant="secondary" className="gap-1.5 rounded-full px-3 py-1">
            <Sparkles className="size-3.5 text-primary" />
            Adaptive UI runtime
          </Badge>
          <div className="flex items-center gap-2">
            <ShareButton />
            <ThemeToggle />
          </div>
        </div>
        <h1 className="text-4xl leading-[1.05] font-semibold tracking-tight sm:text-6xl">
          The dashboard that <span className="morph-gradient-text">morphs</span> to your question.
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground sm:text-lg">
          Ask in plain words. The workspace reshapes itself to answer, and shows why it did.
        </p>
      </header>
      <TalkToUI narrativeEnabled={narrativeEnabled} saveTraces={saveTraces} saveLens={saveLens} />
    </main>
  );
}
