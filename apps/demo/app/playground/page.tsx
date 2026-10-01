import { Playground } from "./Playground";

export const metadata = { title: "MORPH — renderer playground" };

export default function Page() {
  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6">
      <h1 className="mb-1 text-xl font-semibold">Renderer playground</h1>
      <p className="mb-4 text-sm text-slate-600">
        Two hard-coded states. Toggling animates adds, removes and moves.
      </p>
      <Playground />
    </main>
  );
}
