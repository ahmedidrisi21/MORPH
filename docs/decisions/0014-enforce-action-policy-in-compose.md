# 0014 — Enforce `policy.canAct` when components are composed

## Context
SPEC §10 gives `Policy` two methods, `canRender` and `canAct`, and says policy runs at pruning and
again per component after compose. Only `canRender` was wired. `canAct` was defined and unit-tested
but nothing called it, so a policy that denies an action had no effect: the demo's viewer policy
("viewers can only run low-risk actions") was unreachable, and the recommendations workspace offered
every registered action, including the critical one, to every role. The core cannot see inside a
component's props, so it did not know which actions a component offers.

## Decision
Additive, optional members only (the same reasoning as ADR 0003; no spec-shaped signature changes):

- `CapabilityDef.actions?: { ids(props), keep(props, allowed) }`. A capability that offers
  registered actions says how to read their IDs from validated props and how to drop the denied
  ones.
- `checkActions()` in `compose/`: for each action ID it calls `policy.canAct` (an ID the registry
  does not know is denied, rule `registry`) and returns the props limited to the permitted actions
  plus one policy-log entry per denial, subject `<componentId>/action:<actionId>`.
- `compose()` applies it after prop validation. A component left with no action is removed and
  counts as a removed component, so a required one makes the candidate invalid, as for `canRender`.
- Pruning (`createMorph`, SPEC §8.2) applies the same check, so a leaf whose required component
  would lose every action is never offered to the model. Both paths share `checkActions`, so they
  cannot disagree.
- The demo's `action` capability declares the hooks. No demo permission or role changed: a sales
  manager still sees all four actions, a viewer sees the two low-risk ones.

## Consequences
- Denials appear in `trace.policy` and in the inspector.
- Capabilities without the hook behave exactly as before.
- This enforces what is *rendered*. Nothing executes an action in the demo ("Queued (demo)"), so
  there is still no execution-time guard; an app that wires real actions must call
  `policy.canAct` (and `requiresConfirmation`) before running one.
- Risk used by the gate is still the capability's risk (`action` is medium), not the highest risk of
  the actions inside it. Unchanged here.
