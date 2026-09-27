import type { DecisionSpec } from "@morph/core";

/** MVP decision set (SPEC §7.5). All on the `core` lens so a turn is one provider request. */
export const specs: DecisionSpec[] = [
  {
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
  },
  {
    id: "focus_metric",
    kind: "choice",
    lens: "core",
    instructions: "Which metric is the `intent` mainly about?",
    options: {
      revenue: "Money from sales: revenue, sales, income, or bookings.",
      orders: "The number of orders or purchases.",
      profit: "Profit or margin: revenue minus cost.",
      customer_count: "How many customers are buying.",
      not_stated: "The intent does not name or clearly imply a metric.",
    },
  },
  {
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
  },
  {
    id: "density",
    kind: "score",
    lens: "core",
    instructions: "Given `user_role` and `intent`, how much detail should the workspace show?",
    levels: [
      "Headline numbers only",
      "Headline numbers plus one or two detailed views",
      "Full tables and multiple comparisons",
    ],
  },
  {
    id: "show_actions",
    kind: "noul",
    lens: "core",
    instructions:
      "Does the `intent` ask what to do next, or ask to take an action such as contacting, exporting, or escalating?",
  },
];

export const STATIC_SPEC_IDS = specs.map((s) => s.id);
