import { keywordRule, type Rule, RulesProvider, stateText } from "@morph/core";

// Offline rules for every MVP spec (SPEC §7.5) and every workspace-tree question (§8.1).
// They read only the `core` lens state. Uncalibrated: the gate caps their confidence.

const REFINE = /\b(only|just|filter|limit|narrow|exclude|hide|sort|top \d+|top (few|ten|five))\b/i;
const GREETING = /^\s*(hi|hello|hey|yo|thanks|thank you|ok|okay)\b/i;
const DOMAIN =
  /\b(revenue|sales?|orders?|profit|margin|customers?|clients?|accounts?|segments?|compare|comparison|quarter|month|year|trend|why|what should|next step|recommend|actions?|overview|summary|churn|risk|drop|fall|fell|declin\w*|save|win back|look into|investigat\w*)\b/i;

const turnType: Rule = (state) => {
  const intent = stateText(state, "intent");
  const current = stateText(state, "current_workspace");
  const hasWorkspace = current !== "" && !current.startsWith("none");
  if (GREETING.test(intent) || !DOMAIN.test(intent)) return { unclear: 6 };
  if (REFINE.test(intent))
    return hasWorkspace ? { refine_current: 6 } : { new_topic: 3, unclear: 1 };
  return { new_topic: 6 };
};

const focusMetric = keywordRule(
  [
    { label: "revenue", pattern: /\b(revenue|sales|income|money|fall|fell|drop)\b/i },
    { label: "orders", pattern: /\b(orders?|purchases?)\b/i },
    { label: "profit", pattern: /\b(profit|margin)\b/i },
    {
      label: "customer_count",
      pattern: /\b(how many customers|customer count|number of customers|churn)\b/i,
    },
  ],
  { otherwise: "not_stated" },
);

const refineFilter = keywordRule(
  [
    {
      label: "recoverable",
      pattern: /\b(can save|could save|save|win back|recover\w*|rescue|bring back)\b/i,
      weight: 6,
    },
    { label: "high_impact", pattern: /\b(biggest|largest|most impact|high impact|matter most)\b/i },
    { label: "declining", pattern: /\b(declin\w*|dropping|going down|falling|shrinking)\b/i },
    { label: "top_n", pattern: /\b(top \d+|top (few|ten|five)|first \d+|just the top)\b/i },
  ],
  { otherwise: "none" },
);

const density = keywordRule(
  [
    { label: "0", pattern: /\b(summary|headline|quick|glance|just the numbers)\b/i },
    { label: "2", pattern: /\b(detail\w*|full|everything|breakdown|all the data|tables?)\b/i },
  ],
  { otherwise: "1" },
);

const ACTION =
  /\b(what should (i|we) do|do next|next steps?|recommend\w*|contact|email|call|export|escalate|reach out)\b/i;
const showActions: Rule = (state) => (ACTION.test(stateText(state, "intent")) ? 0.9 : 0.1);

const wsRoot = keywordRule(
  [
    {
      label: "overview",
      pattern:
        /\b(overview|summary|how (are|is) (we|it|the business) doing|big picture|dashboard)\b/i,
    },
    {
      label: "investigation",
      pattern:
        /\b(why|cause|reason|explain|what happened|drove|drivers?|fell|fall|drop|declin\w*|investigat\w*|look into)\b/i,
    },
    {
      label: "comparison",
      pattern: /\b(compare|comparison|vs\.?|versus|side by side|against)\b/i,
    },
    { label: "customers", pattern: /\b(customers?|clients?|accounts?)\b/i },
    { label: "action", pattern: ACTION },
  ],
  { otherwise: "overview" },
);

const wsInvestigation = keywordRule(
  [
    { label: "by_time", pattern: /\b(over time|trend|monthly|when|period|timeline)\b/i },
    { label: "by_segment", pattern: /\b(segments?|enterprise|smb|mid-market|groups?|regions?)\b/i },
    { label: "by_customer", pattern: /\b(customers?|clients?|accounts?|who)\b/i },
  ],
  { otherwise: "by_time" },
);

const wsComparison = keywordRule(
  [
    {
      label: "period_vs_period",
      pattern: /\b(quarter|month|year|week|period|last|previous|prior)\b/i,
    },
    { label: "segment_vs_segment", pattern: /\b(segments?|enterprise|smb|groups?|regions?)\b/i },
  ],
  { otherwise: "period_vs_period" },
);

const wsCustomers = keywordRule(
  [{ label: "at_risk", pattern: /\b(at risk|risk\w*|churn\w*|leav\w*|losing|declin\w*)\b/i }],
  { otherwise: "list" },
);

export const rules: Record<string, Rule> = {
  turn_type: turnType,
  focus_metric: focusMetric,
  refine_filter: refineFilter,
  density,
  show_actions: showActions,
  "ws.root": wsRoot,
  "ws.investigation": wsInvestigation,
  "ws.comparison": wsComparison,
  "ws.customers": wsCustomers,
};

export function createRulesProvider(): RulesProvider {
  return new RulesProvider({ rules });
}
