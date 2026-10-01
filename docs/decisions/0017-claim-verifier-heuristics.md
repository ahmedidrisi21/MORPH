# 0017 — Heuristics in the claim verifier

## Context
The claim corpus (ADR 0016) listed 12 gaps in `verifyClaims`: 9 wrong claims it kept and 3 right claims it dropped. The user chose option B (heuristics) over a new claim format (A) or a model check (C).

## Decision
`verifyClaims` keeps its signature and claim format. It now also:
- reads number words ("twenty-five percent", "seven") and drops amount words ("half", "halved", "doubled", "a third") unless a cited fact uses the word;
- reads "$2.3M", "$2271K" and "2.3 million", and compares at the precision written (±half the last digit). This replaces the old 0/1 decimal rule, so "17.24%" against -17.24 is now accepted;
- ignores a year after a month or "since/in/by/…";
- requires "$" figures to match money facts and "%" figures to match percentage facts;
- drops a claim that names something the cited facts do not mention (an acronym or mid-sentence name, or a name another fact has), a scope they lack ("year over year"), a cause when none of them has a causal word, or a negated direction ("did not fall");
- requires a number in a clause that names a subject to match a fact about that subject.

## Consequences
- Result on the corpus: 11 of 12 gaps closed. The one left: a cause that reuses a causal word ("drove") from another cited fact. Only a semantic check (C) can catch that.
- More claims fall back to the facts' own sentences. This is the safe direction, and every fact's own sentence is tested to be kept.
- Known false-drop risk: "two", "third" or "quarter" used as ordinary words, and capitalised words the facts lack. Watch the narrative-error and keep-rate metrics.
- Pure heuristics: they can be wrong both ways. `fixtures/narrative/claims.json` is the record.
- The old test expecting "17.24%" to be unsupported was wrong about a true number and was corrected.
