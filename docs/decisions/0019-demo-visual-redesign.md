# 0019 — Demo visual redesign

## Context
The demo looked like a default template: flat white cards, grey text, default chart colours and no dark mode. The owner asked for an eye-catching, adaptive dashboard built on shadcn/ui.

## Decision
- A new theme in `app/globals.css` (violet, pink and cyan tokens for light and dark, a soft gradient background) on the existing shadcn variables. A light/dark switch follows the system and remembers the choice.
- Morph components (KPI, chart, table, insight, action, alert) are restyled with shadcn `Card`, `Badge` and the new `Avatar`, plus lucide icons. Their props and Zod schemas do not change. Charts use theme colours with gradients.
- A new `AdaptiveStrip` shows what the dashboard is showing and how sure the last change was, from `useMorph().lastTrace`. A share button copies the link; the page has social metadata and an icon.
- `morph-react` is not changed. Its neutral classes are restyled from the demo through the data attributes it already exposes (`[data-suggestion]`, `[data-pending]`, …), scoped under `[data-morph-shell]`. No public API changes (SPEC §11.6).
- shadcn's `chart` primitive was not used: it renders its theme with `dangerouslySetInnerHTML`, which SPEC I2 forbids anywhere in the codebase. Charts stay on Recharts directly.
- `registry.json` lists the new primitive dependencies (`badge`, `avatar`) and `lucide-react`.

## Consequences
- No new packages. The demo is heavier on CSS that targets library attributes; renaming one of those attributes in `morph-react` would unstyle the demo (the e2e tests rely on the same attributes).
- The dev-only inspector panel is lightly themed for dark mode.
