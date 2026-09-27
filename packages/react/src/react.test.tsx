import { createMorph, type MorphUIState } from "@morph/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  facts,
  makeCtx,
  registry,
  rulesProvider,
  specs,
  templates,
  tree,
} from "../../core/src/__fixtures__/miniApp";
import { MorphProvider, type Renderers, useMorph } from "./context";
import { MorphAlternates } from "./MorphAlternates";
import { MorphIntentBar } from "./MorphIntentBar";
import { MorphWorkspace } from "./MorphWorkspace";

const renderers: Renderers = {
  kpi: ({ props }: { props: { label: string; value: number } }) => (
    <span data-kpi>
      {props.label}={props.value}
    </span>
  ),
  table: ({ props }: { props: { rows: string[] } }) => (
    <ul>
      {props.rows.map((r) => (
        <li key={r}>{r}</li>
      ))}
    </ul>
  ),
  action: () => <button type="button">act</button>,
  secret: () => <p>secret</p>,
} as unknown as Renderers;

function setup() {
  const morph = createMorph({
    registry,
    templates,
    tree,
    specs,
    provider: rulesProvider(),
    idGen: (() => {
      let i = 0;
      return () => `t${i++}`;
    })(),
  });
  const initial = morph.composeLeaf("investigation.by_customer", makeCtx("start"));
  return { morph, initial };
}

const base = { user: { role: "sales_manager", permissions: ["read:sales"] }, facts };

describe("@morph/react", () => {
  it("renders the workspace with validated props", () => {
    const { morph, initial } = setup();
    const html = renderToStaticMarkup(
      <MorphProvider morph={morph} renderers={renderers} context={base} initialState={initial}>
        <MorphIntentBar suggestions={["Why did revenue fall?"]} />
        <MorphWorkspace />
      </MorphProvider>,
    );
    expect(html).toContain('data-workspace="investigation.by_customer"');
    expect(html).toContain("Revenue=1");
    expect(html).toContain("Why did revenue fall?");
  });

  it("renders MorphError instead of a component with invalid props, and traces it", () => {
    const { morph, initial } = setup();
    const broken: MorphUIState = {
      ...initial,
      components: [
        {
          id: "x:kpi:bad",
          type: "kpi",
          props: { label: "R", value: "not a number" },
          slot: "main",
          priority: 0,
        },
      ],
    };
    const html = renderToStaticMarkup(
      <MorphProvider morph={morph} renderers={renderers} context={base} initialState={broken}>
        <MorphWorkspace />
      </MorphProvider>,
    );
    expect(html).toContain('data-morph-error="x:kpi:bad"');
    expect(html).not.toContain("Revenue=");
  });

  it("asserts every registered type has a renderer", () => {
    const { morph } = setup();
    const { secret: _omit, ...partial } = renderers;
    expect(() =>
      renderToStaticMarkup(<MorphProvider morph={morph} renderers={partial} context={base} />),
    ).toThrow(/No renderer for capability "secret"/);
  });

  it("shows alternates, pending banners and exposes useMorph", async () => {
    const { morph, initial } = setup();
    morph.setState({ ...initial, workspaceId: "overview.default" });
    await morph.resolve(
      makeCtx("look into customers", {
        ui: {
          workspaceId: "overview.default",
          componentIds: [],
          lastMorphAt: null,
          activeFilter: null,
        },
      }),
    );
    let seen: ReturnType<typeof useMorph> | null = null;
    const Probe = () => {
      seen = useMorph();
      return null;
    };
    const html = renderToStaticMarkup(
      <MorphProvider morph={morph} renderers={renderers} context={base}>
        <Probe />
        <MorphAlternates />
        <MorphWorkspace />
      </MorphProvider>,
    );
    expect(seen).not.toBeNull();
    expect(html).toContain("data-pending");
    expect(() => renderToStaticMarkup(<Probe />)).toThrow(/inside <MorphProvider>/);
  });
});
