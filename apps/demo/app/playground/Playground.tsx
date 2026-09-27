"use client";
import {
  type ComponentInstance,
  createMorph,
  type MorphUIState,
  RingBufferSink,
  RulesProvider,
} from "@morph/core";
import { MorphProvider, MorphWorkspace } from "@morph/react";
import { useMemo, useState } from "react";
import { renderers } from "@/components/morph/renderers";
import { Button } from "@/components/ui/button";
import { registry } from "@/lib/morph/registry";

// M1 playground: two hard-coded states that exercise add, remove and move animations.
const kpi = (key: string, label: string, value: string, priority: number): ComponentInstance => ({
  id: `play:kpi:${key}`,
  type: "kpi",
  props: { label, value, tone: "flat" },
  slot: "header",
  priority,
});

const chart: ComponentInstance = {
  id: "play:chart:trend",
  type: "chart",
  slot: "main",
  priority: 0,
  props: {
    title: "Revenue by month",
    kind: "bar",
    xKey: "m",
    series: [{ key: "v", label: "Revenue" }],
    data: [
      { m: "Jan", v: 120 },
      { m: "Feb", v: 132 },
      { m: "Mar", v: 101 },
    ],
  },
};

const table: ComponentInstance = {
  id: "play:table:customers",
  type: "table",
  slot: "side",
  priority: 0,
  props: {
    title: "Customers",
    columns: [
      { key: "name", label: "Name" },
      { key: "v", label: "Revenue", align: "right" },
    ],
    rows: [
      { id: "a", cells: { name: "Acme", v: "$12k" } },
      { id: "b", cells: { name: "Globex", v: "$9k" } },
    ],
  },
};

const base: Omit<MorphUIState, "workspaceId" | "title" | "components"> = {
  version: 1,
  layout: "overview",
  density: 1,
  filter: null,
  alternates: [],
  pending: null,
  traceId: "playground",
};

const stateA: MorphUIState = {
  ...base,
  workspaceId: "playground.a",
  title: "State A",
  components: [kpi("revenue", "Revenue", "$1.2M", 0), kpi("orders", "Orders", "8,210", 1), chart],
};

const stateB: MorphUIState = {
  ...base,
  workspaceId: "playground.b",
  title: "State B",
  components: [
    kpi("orders", "Orders", "8,210", 0),
    kpi("revenue", "Revenue", "$1.2M", 1),
    kpi("profit", "Profit", "$310k", 2),
    table,
  ],
};

const broken: ComponentInstance = {
  id: "play:kpi:broken",
  type: "kpi",
  slot: "main",
  priority: 9,
  props: { label: "Broken", value: 42 },
};

export function Playground() {
  const sink = useMemo(() => new RingBufferSink(), []);
  const morph = useMemo(
    () =>
      createMorph({
        registry,
        templates: [
          {
            leafId: "a",
            title: () => "A",
            layout: "overview",
            requiresData: [],
            required: [],
            supportsFilters: [],
            build: () => [],
          },
        ],
        tree: { id: "a", description: "Playground" },
        specs: [],
        provider: new RulesProvider({ rules: {} }),
        traceSink: sink,
        initialState: stateA,
      }),
    [sink],
  );
  const [which, setWhich] = useState<"a" | "b">("a");
  const [withBroken, setWithBroken] = useState(false);
  const [errors, setErrors] = useState(0);

  const apply = (w: "a" | "b", br: boolean) => {
    const s = w === "a" ? stateA : stateB;
    morph.setState(br ? { ...s, components: [...s.components, broken] } : s);
    setTimeout(() => setErrors(sink.events().filter((e) => e.type === "render_error").length), 0);
  };

  return (
    <MorphProvider morph={morph} renderers={renderers} context={null}>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          data-toggle
          onClick={() => {
            const next = which === "a" ? "b" : "a";
            setWhich(next);
            apply(next, withBroken);
          }}
        >
          Toggle state (now {which.toUpperCase()})
        </Button>
        <Button
          variant="outline"
          data-break
          onClick={() => {
            setWithBroken(!withBroken);
            apply(which, !withBroken);
          }}
        >
          {withBroken ? "Remove invalid component" : "Add a component with invalid props"}
        </Button>
        <span className="self-center text-xs text-slate-500" data-render-errors={errors}>
          Traced render errors: {errors}
        </span>
      </div>
      <MorphWorkspace />
    </MorphProvider>
  );
}
