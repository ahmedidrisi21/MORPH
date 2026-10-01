import type { Fact } from "../facts/types";
import type { Claim } from "./claims";

export const NUMBER_RE = /-?\d+(?:[.,]\d+)?%?/g;

export interface VerifiedClaims {
  kept: Claim[];
  dropped: { claim: Claim; reason: string }[];
}

const DOWN =
  /\b(fell|fall(?:s|ing|en)?|declin\w*|drop(?:s|ped|ping)?|decreas\w*|shr[ia]nk\w*|lower|down)\b/i;
const UP =
  /\b(rose|ris(?:e|es|ing|en)|grew|grow(?:s|th|ing)?|increas\w*|climb\w*|gain\w*|higher|up)\b/i;

/** "up" or "down" when the text points one way only; null when neutral or mixed. */
function direction(text: string): "up" | "down" | null {
  const down = DOWN.test(text);
  const up = UP.test(text);
  return down === up ? null : down ? "down" : "up";
}

// ---- numbers -------------------------------------------------------------------------------

type NumUnit = "pct" | "usd" | null;
interface NumToken {
  raw: string;
  value: number;
  /** Half of the last stated digit, scaled: how far the claim may sit from the fact. */
  tol: number;
  unit: NumUnit;
  /** Whole number with no unit or suffix: a candidate year. */
  plain: boolean;
  index: number;
}

const SCALE: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
};
const DIGITS_RE =
  /(\$)?(\d+(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?)(?:\s?(%|percent\b|per cent\b|thousand\b|million\b|billion\b|bn\b|[kmb]\b))?/gi;

const ONES: Record<string, number> = {
  zero: 0,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const UNIT_DIGIT: Record<string, number> = { one: 1, ...ONES };
// "one" alone is mostly a pronoun ("no one", "one of"), so it counts only inside "twenty-one".
const WORDS_RE = new RegExp(
  `\\b(?:(${Object.keys(TENS).join("|")})(?:[- ](one|two|three|four|five|six|seven|eight|nine))?|(${Object.keys(ONES).join("|")}))\\b(\\s?(?:%|percent\\b|per cent\\b))?`,
  "gi",
);
/** Amounts said as a word. They never match a figure, so a claim using one must find it in the fact. */
const AMOUNT_WORD_RE =
  /\b(half|halved|halving|thirds?|quarters?|doubl\w+|tripl\w+|twice|thrice|tenfold)\b/gi;

const MONTH_RE =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?\s*$/i;
const YEAR_PREP_RE = /\b(?:since|in|during|by|from|until|through|of|for)\s*$/i;

function unitOf(suffix: string | undefined, dollar: boolean): NumUnit {
  if (dollar) return "usd";
  return suffix && /^(%|per ?cent)/i.test(suffix) ? "pct" : null;
}

function decimals(numeric: string): number {
  const m = /[.,](\d+)$/.exec(numeric);
  return m && !/^\d+(?:,\d{3})+$/.test(numeric) ? (m[1] as string).length : 0;
}

function numberTokens(text: string): NumToken[] {
  const out: NumToken[] = [];
  for (const m of text.matchAll(DIGITS_RE)) {
    const numeric = m[2] as string;
    const thousands = /^\d+(?:,\d{3})+/.test(numeric);
    const value = Number(thousands ? numeric.replace(/,/g, "") : numeric.replace(",", "."));
    const suffix = m[3]?.toLowerCase();
    const mult = suffix ? (SCALE[suffix] ?? 1) : 1;
    const dp = decimals(numeric);
    const unit = unitOf(suffix, m[1] === "$");
    const index = m.index ?? 0;
    out.push({
      raw: m[0].trim(),
      value: value * mult,
      tol: 0.5 * 10 ** -dp * mult * 1.000001,
      unit,
      plain: !m[1] && !suffix && dp === 0 && !thousands,
      index,
    });
  }
  for (const m of text.matchAll(WORDS_RE)) {
    const value = m[1]
      ? (TENS[m[1].toLowerCase()] as number) +
        (m[2] ? (UNIT_DIGIT[m[2].toLowerCase()] as number) : 0)
      : (ONES[(m[3] as string).toLowerCase()] as number);
    out.push({
      raw: m[0].trim(),
      value,
      tol: 0.5,
      unit: unitOf(m[4]?.trim(), false),
      plain: false,
      index: m.index ?? 0,
    });
  }
  return out;
}

/** A four-digit year after a month or "since/in/by/…" says when, not how much. */
function isYear(tok: NumToken, text: string): boolean {
  if (!tok.plain || tok.value < 1900 || tok.value > 2100) return false;
  const before = text.slice(0, tok.index);
  return MONTH_RE.test(before) || YEAR_PREP_RE.test(before);
}

function unitFits(tok: NumToken, fact: Fact, factTok?: NumToken): boolean {
  if (tok.unit === null) return true;
  const have = factTok?.unit ?? (fact.unit === "pct" || fact.unit === "usd" ? fact.unit : null);
  return have === null ? factTok === undefined && fact.unit === undefined : have === tok.unit;
}

function matchesFact(tok: NumToken, fact: Fact): boolean {
  for (const ft of numberTokens(fact.text)) {
    if (Math.abs(ft.value - tok.value) < 1e-9 && unitFits(tok, fact, ft)) return true;
  }
  if (typeof fact.value !== "number" || !unitFits(tok, fact)) return false;
  return Math.abs(Math.abs(fact.value) - Math.abs(tok.value)) <= tok.tol;
}

// ---- words ---------------------------------------------------------------------------------

const NEGATION = /\b(?:not|never|no longer|no|without|cannot)\b|n't\b/i;
const SCOPE =
  /\b(?:year[- ]over[- ]year|yoy|year[- ]on[- ]year|annual\w*|last year|this year|quarter(?:ly|s)?|weekly|daily|per (?:day|week|year))\b/gi;
const CAUSE =
  /\b(?:because|due to|caused|result of|thanks to|owing to|as a result|stems? from|attributed to|driven by|reason)\b/i;
const CAUSE_IN_FACT =
  /\b(?:drove|drive[sn]?|driving|because|due|caused?|accounts? for|attribut\w+|result\w*)\b/i;

const CALENDAR = new Set(
  "january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday".split(
    " ",
  ),
);
const ACRONYMS = new Set("usd kpi csv ai yoy mom qoq us uk eu vat id roi".split(" "));
const STOP_CAPS = new Set(
  "the a an in on of for to and or but if as at by with from this that these those it its is are was were be".split(
    " ",
  ),
);

/** Capitalised words and acronyms, with whether each starts a sentence or clause. */
function capsWords(text: string): { word: string; start: boolean }[] {
  const out: { word: string; start: boolean }[] = [];
  for (const m of text.matchAll(/\b[A-Z][A-Za-z]*\b/g)) {
    const before = text.slice(0, m.index).trimEnd();
    const start = before === "" || /[.!?:—\-("'“]$/.test(before);
    out.push({ word: m[0], start });
  }
  return out;
}

const hay = (f: Fact) => `${f.label} ${f.text} ${typeof f.value === "string" ? f.value : ""}`;
const mentions = (haystack: string, word: string) =>
  new RegExp(`\\b${word}\\b`, "i").test(haystack);

/** Numbers and amount words in the claim that no cited fact supports; "" when all do. */
function unsupportedNumbers(claim: Claim, refs: Fact[]): string[] {
  const bad = numberTokens(claim.text)
    .filter((t) => !isYear(t, claim.text))
    .filter((t) => !refs.some((f) => matchesFact(t, f)))
    .map((t) => t.raw);
  const facts = refs.map((f) => f.text).join(" ");
  for (const m of claim.text.matchAll(AMOUNT_WORD_RE)) {
    if (!mentions(facts, m[0])) bad.push(m[0]);
  }
  return bad;
}

/** The first problem with names, scope, causes or negation; null when there is none. */
function wordProblem(claim: Claim, refs: Fact[], all: Fact[]): string | null {
  const cited = refs.map(hay).join(" ");
  const known = new Set<string>();
  for (const f of all) {
    for (const { word } of capsWords(hay(f))) {
      const w = word.toLowerCase();
      if (!STOP_CAPS.has(w) && !CALENDAR.has(w)) known.add(w);
    }
  }
  for (const { word, start } of capsWords(claim.text)) {
    const w = word.toLowerCase();
    if (STOP_CAPS.has(w) || CALENDAR.has(w) || ACRONYMS.has(w) || mentions(cited, w)) continue;
    const acronym = word.length > 1 && word === word.toUpperCase();
    if (known.has(w) || acronym || !start)
      return `names "${word}", which the cited fact(s) do not mention`;
  }
  for (const m of claim.text.matchAll(SCOPE)) {
    if (!mentions(cited, m[0])) return `says "${m[0]}", which the cited fact(s) do not`;
  }
  if (CAUSE.test(claim.text) && !CAUSE_IN_FACT.test(cited)) {
    return "gives a cause the cited fact(s) do not";
  }
  if (NEGATION.test(claim.text) && direction(claim.text)) return "negates a direction";
  // A number must belong to the thing it sits next to: in a clause that names a subject, it
  // must match a fact that mentions that subject ("Enterprise accounts for 17%" cites 17% of revenue).
  for (const clause of claim.text.split(
    /(?<!\d),|,(?!\d)|[;:]|\b(?:while|but|and|which|whereas)\b/i,
  )) {
    const names = capsWords(clause)
      .map((c) => c.word)
      .filter((w) => mentions(cited, w));
    const nums = numberTokens(clause).filter((t) => !isYear(t, clause));
    if (!names.length || !nums.length) continue;
    const owners = refs.filter((f) => names.some((n) => mentions(hay(f), n)));
    for (const t of nums) {
      if (!owners.some((f) => matchesFact(t, f))) {
        return `puts ${t.raw} next to ${names.join("/")}, which no fact about it says`;
      }
    }
  }
  return null;
}

/**
 * Deterministic claim verification (SPEC §12.3). A claim is dropped when it cites an unknown
 * fact, when a number in it (digits, "twenty-five percent", "$2.3M", "17%") does not match a
 * cited fact at the precision it is written, when it uses an amount word ("half", "doubled") the
 * facts do not, or when it says the opposite of every directional fact it cites.
 *
 * Heuristics on top (ADR 0017), each cheap and each able to be wrong in the other direction:
 * a "$" figure must not match a percentage fact and the reverse; a year after a month or
 * "since/in/by" is not a quantity; a name the cited facts do not mention, a scope ("year over
 * year") or a cause they do not give, a negated direction ("did not fall"), and a number placed
 * next to a name that no fact about that name supports, all drop the claim.
 *
 * These cannot judge meaning: an invented cause that reuses a word the facts have, or a wrong
 * relation between right numbers, still gets through. `fixtures/narrative/claims.json` lists
 * what is caught and what is not.
 */
export function verifyClaims(claims: Claim[], facts: Fact[]): VerifiedClaims {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const kept: Claim[] = [];
  const dropped: VerifiedClaims["dropped"] = [];
  for (const claim of claims) {
    const unknown = claim.factIds.filter((id) => !byId.has(id));
    if (claim.factIds.length === 0 || unknown.length) {
      dropped.push({
        claim,
        reason: `unknown fact id(s): ${unknown.join(", ") || "(none cited)"}`,
      });
      continue;
    }
    const refs = claim.factIds.map((id) => byId.get(id) as Fact);
    const bad = unsupportedNumbers(claim, refs);
    if (bad.length) {
      dropped.push({ claim, reason: `unsupported number(s): ${bad.join(", ")}` });
      continue;
    }
    const said = direction(claim.text);
    const factDirs = refs.map((f) => direction(f.text)).filter((d) => d !== null);
    if (said && factDirs.length > 0 && factDirs.every((d) => d !== said)) {
      dropped.push({ claim, reason: `says "${said}", the cited fact(s) say "${factDirs[0]}"` });
      continue;
    }
    const problem = wordProblem(claim, refs, facts);
    if (problem) {
      dropped.push({ claim, reason: problem });
      continue;
    }
    kept.push(claim);
  }
  return { kept, dropped };
}

/** Code-generated fallback: the referenced facts' own sentences. A slot is never blank. */
export function fallbackClaims(facts: Fact[]): Claim[] {
  return facts.map((f) => ({ text: f.text, factIds: [f.id] }));
}
