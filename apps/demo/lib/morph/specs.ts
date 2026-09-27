import type { DecisionSpec } from "@morph/core";

// The MVP decision set (SPEC §7.5). All specs read the `core` lens, so the planner sends them
// in one batch together with the workspace-tree questions: one provider request per turn.

export const turnType: DecisionSpec = {
  id: "turn_type",
  kind: "choice",
  lens: "core",
  instructions:
    "Using `intent` and `current_workspace`, how does this request relate to what the user is looking at now?",
  options: {
    new_topic: "Asks for information or a view that the current workspace does not show.",
    refine_current:
      "Narrows, filters, sorts, or limits what the current workspace already shows (for example 'only show…', 'just the top…'), without changing the topic.",
    unclear: "Too vague to act on, a greeting, or unrelated to this business data.",
  },
};

export const focusMetric: DecisionSpec = {
  id: "focus_metric",
  kind: "choice",
  lens: "core",
  instructions: "Which metric is the `intent` mainly about?",
  options: {
    revenue: "Money earned from sales, including sales totals and revenue changes.",
    orders: "The number or frequency of orders placed.",
    profit: "Profit or margin: what is left after costs.",
    customer_count: "How many customers there are, or how many were gained or lost.",
    not_stated: "The intent does not name or clearly imply a metric.",
  },
};

export const refineFilter: DecisionSpec = {
  id: "refine_filter",
  kind: "choice",
  lens: "core",
  instructions: "If the `intent` limits which items to show, which limit does it describe?",
  options: {
    recoverable: "Customers the user can still win back: still active recently but buying less.",
    high_impact: "Items with the largest effect on revenue.",
    declining: "Anything that is going down.",
    top_n: "Only the first few or top items.",
    none: "The intent does not describe a limit.",
  },
};

export const density: DecisionSpec = {
  id: "density",
  kind: "score",
  lens: "core",
  instructions: "Given `user_role` and `intent`, how much detail should the workspace show?",
  levels: [
    "Headline numbers only",
    "Headline numbers plus one or two detailed views",
    "Full tables and multiple comparisons",
  ],
};

export const showActions: DecisionSpec = {
  id: "show_actions",
  kind: "noul",
  lens: "core",
  instructions:
    "Does the `intent` ask what to do next, or ask to take an action such as contacting, exporting, or escalating?",
};

export const specs: DecisionSpec[] = [turnType, focusMetric, refineFilter, density, showActions];
