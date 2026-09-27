# @morph/react

React bindings for MORPH: `MorphProvider`, `MorphIntentBar`, `MorphAlternates`, `MorphWorkspace`
(animated with `motion`), `MorphInspector`, `MorphWhyThis` and `useMorph`.

```tsx
<MorphProvider morph={morph} renderers={renderers} context={context} initialState={overview}>
  <MorphIntentBar suggestions={["Why did revenue fall?"]} />
  <MorphAlternates />
  <MorphWorkspace />
  <MorphInspector />
</MorphProvider>
```

Components use Tailwind classes. With Tailwind 4, add `@source "../node_modules/@morph/react/dist";`
(adjusted to your layout) so they are generated. See the
[MORPH README](https://github.com/yahyeameer/MORPH#readme).
