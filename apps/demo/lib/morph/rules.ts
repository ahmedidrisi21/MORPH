import { keywordRule, type Rule, RulesProvider, stateText } from "morph-core";

// Deterministic offline rules for every MVP spec and tree question (SPEC §7.3).
// They read only lens state: intent, previous intents and the current workspace.

const CUSTOMERS = /\b(customers?|clients?|accounts?|who)\b/i;
const INVESTIGATE =
  /\b(why|cause[sd]?|fall|fell|fallen|drop(ped)?|declin\w*|look into|investigate|explain|what happened)\b/i;
const COMPARE = /\b(compare|comparison|versus|vs\.?|side by side|against)\b/i;
const ACTION = /\b(what should (i|we) do|do next|next steps?|recommend\w*|what can (i|we) do)\b/i;
const OVERVIEW = /\b(overview|summary|dashboard|how are we doing|big picture|home)\b/i;
const REFINE = /\b(only|just|filter|limit|narrow|exclude|except)\b/i;

const turnType: Rule = (state) => {
  const intent = stateText(state, "intent");
  const onStartScreen = stateText(state, "current_workspace").startsWith("none");
  // Nothing to refine on the start screen: a limit there starts a new topic.
  if (REFINE.test(intent) && !onStartScreen) return { refine_current: 6, new_topic: 1 };
  const domain = [
    CUSTOMERS,
    INVESTIGATE,
    COMPARE,
    ACTION,
    OVERVIEW,
    /\b(revenue|sales|orders?|profit|margin|segments?|trend|quarter|month)\b/i,
  ];
  if (domain.some((re) => re.test(intent))) return { new_topic: 1 };
  return { unclear: 1 };
};

const wsRoot: Rule = (state) => {
  const intent = stateText(state, "intent");
  const current = stateText(state, "current_workspace");
  const w: Record<string, number> = {};
  const add = (k: string, n: number) => {
    w[k] = (w[k] ?? 0) + n;
  };
  if (OVERVIEW.test(intent)) add("overview", 3);
  if (INVESTIGATE.test(intent)) add("investigation", 1);
  if (COMPARE.test(intent)) add("comparison", 3);
  if (CUSTOMERS.test(intent)) add("customers", 1);
  if (ACTION.test(intent)) add("action", 6);
  // Asking for "the customers" while investigating a change means the customers behind it.
  if (CUSTOMERS.test(intent) && current.startsWith("investigation") && !ACTION.test(intent))
    add("investigation", 6);
  return w;
};

export const rules: Record<string, Rule> = {
  turn_type: turnType,
  focus_metric: keywordRule(
    [
      { label: "revenue", pattern: /\b(revenue|sales|income|bookings)\b/i },
      { label: "orders", pattern: /\b(orders?|purchases?)\b/i },
      { label: "profit", pattern: /\b(profit|margins?)\b/i },
      {
        label: "customer_count",
        pattern: /\b(how many customers|customer count|number of customers)\b/i,
      },
    ],
    { otherwise: "not_stated" },
  ),
  refine_filter: keywordRule(
    [
      { label: "recoverable", pattern: /\b(save|win back|recover\w*|rescue|keep)\b/i, weight: 3 },
      {
        label: "high_impact",
        pattern: /\b(biggest|largest|most impact\w*|high impact|matter most)\b/i,
        weight: 3,
      },
      {
        label: "declining",
        pattern: /\b(declin\w*|dropping|going down|shrinking|falling)\b/i,
        weight: 3,
      },
      { label: "top_n", pattern: /\b(top|first few|best)\b/i, weight: 3 },
    ],
    { otherwise: "none" },
  ),
  density: (state) => {
    const intent = stateText(state, "intent");
    if (/\b(detail(ed|s)?|full|everything|all)\b/i.test(intent)) return { "2": 1 };
    if (/\b(quick|headline|glance|tl;?dr)\b/i.test(intent)) return { "0": 1 };
    return { "1": 1 };
  },
  show_actions: (state) =>
    /\b(what should|do next|recommend|contact|email|export|escalate|call)\b/i.test(
      stateText(state, "intent"),
    )
      ? 0.9
      : 0.1,
  "ws.root": wsRoot,
  "ws.investigation": keywordRule(
    [
      { label: "by_customer", pattern: CUSTOMERS, weight: 3 },
      {
        label: "by_segment",
        pattern: /\b(segments?|enterprise|smb|mid-?market|education|public sector|group)\b/i,
        weight: 3,
      },
      { label: "by_time", pattern: /\b(why|fall|fell|trend|over time|months?|when)\b/i },
    ],
    { otherwise: "by_time" },
  ),
  "ws.comparison": keywordRule(
    [
      {
        label: "period_vs_period",
        pattern: /\b(quarters?|months?|years?|periods?|last|previous|prior)\b/i,
      },
      {
        label: "segment_vs_segment",
        pattern: /\b(segments?|enterprise|smb|mid-?market|groups?)\b/i,
        weight: 2,
      },
    ],
    { otherwise: "period_vs_period" },
  ),
  "ws.customers": keywordRule(
    [{ label: "at_risk", pattern: /\b(risk\w*|leav\w*|churn\w*|losing|lost|declin\w*)\b/i }],
    { otherwise: "list" },
  ),
};

export function createRulesProvider(): RulesProvider {
  return new RulesProvider({ rules });
}
