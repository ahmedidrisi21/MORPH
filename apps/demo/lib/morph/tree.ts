import type { TreeNode } from "morph-core";

/** MVP workspace tree (SPEC §8.1). */
export const tree: TreeNode = {
  id: "root",
  description: "All workspaces.",
  question: "Which kind of workspace best supports the `intent`?",
  children: [
    {
      id: "overview",
      description: "A general summary of how the business is doing.",
      children: [
        { id: "overview.default", description: "Headline metrics and the monthly trend." },
      ],
    },
    {
      id: "investigation",
      description: "Explains why a metric changed or what caused a problem.",
      question:
        "Assuming the user needs an investigation workspace, which explanation fits the `intent` best?",
      children: [
        {
          id: "investigation.by_time",
          description: "How the metric changed over time, with a period comparison.",
        },
        {
          id: "investigation.by_segment",
          description: "Which customer segments drove the change.",
        },
        {
          id: "investigation.by_customer",
          description: "Which individual customers drove the change.",
        },
      ],
    },
    {
      id: "comparison",
      description: "Puts two or more periods or groups side by side.",
      question: "Assuming the user needs a comparison workspace, what does the `intent` compare?",
      children: [
        {
          id: "comparison.period_vs_period",
          description:
            "One time period against another, such as this quarter against last quarter.",
        },
        {
          id: "comparison.segment_vs_segment",
          description: "Customer segments against each other.",
        },
      ],
    },
    {
      id: "customers",
      description: "Lists or filters specific customers.",
      question: "Assuming the user needs a customer list, which list fits the `intent` best?",
      children: [
        { id: "customers.list", description: "All customers with their recent revenue." },
        {
          id: "customers.at_risk",
          description: "Customers whose buying is declining or who may leave.",
        },
      ],
    },
    {
      id: "action",
      description: "Suggests what to do next and offers actions.",
      children: [
        {
          id: "action.recommendations",
          description: "Recommended actions for the customers driving the decline.",
        },
      ],
    },
  ],
};

export const TREE_SPEC_IDS = ["ws.root", "ws.investigation", "ws.comparison", "ws.customers"];
