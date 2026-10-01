# 0020 — G11 and G12 hold on rules, not on live Jev

## Context
G11 ("look into customers and revenue") expects the gate to offer two alternates. On rules it does. On live `jev-1.13.0` the gate clarifies or confirms instead, and G12 shares its first turn. ADR 0010 and 0011 left the choice to a human: reword the tree questions, or accept the difference.

## What was tried (2026-10-01, live `jev-1.13.0`)
- As written: root answer customers 0.59 to 0.71, investigation about 0.15. The top two candidates were `customers.list` and `investigation.by_customer`, a separation of 2.1 to 3.3 against the 1.25 needed for alternates. Path confidence 0.49 to 0.63 sat below the low-risk 0.75, so the outcome was clarify or confirm.
- Descriptions that say what each workspace fits ("fits requests to look into … revenue", "… to see, show or find customers"): the root swung to investigation (0.87 to 0.98), still not an even split. The same went for adding "look into customers" to the customers description.
- A root question that tells the model to share probability when two kinds are asked for: no effect (customers 0.68 to 0.71).
- A different phrase, "What changed with customers?", gave alternates in 3 of 4 live runs (separation 1.07 to 1.19) and clarified in the fourth (1.37). That would change a SPEC §13.3 scenario and still flake.

## Decision
Accept the live difference. The goldens, the tree wording and the gate thresholds are unchanged. In `golden.golden.test.ts`, `LIVE_DIFFERS` lists G11 and G12: on live Jev they run as `[live: differs from golden]`, check only that the UI is never blank, and never record fixtures. They still run in full on rules, and stay in `UNRECORDED_REPLAY`.

## Consequences
- `pnpm test:golden:live` is green (26 of 26) and records nothing that fails a golden.
- Ambiguity handling on live Jev is covered by G06 and G07 (clarify) and by rules for alternates; no replay recording backs the alternates path.
- Live Jev is decisive about this phrase. If a future model splits it evenly, remove G11 and G12 from both sets and record them.
