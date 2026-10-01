import {
  createMorph,
  type DecisionProvider,
  type GateConfig,
  type MorphConfig,
  type TraceSink,
} from "morph-core";
import { demoPolicy } from "./policy";
import { registry } from "./registry";
import { specs } from "./specs";
import { templates } from "./templates";
import { tree } from "./tree";

export { DEMO_USER, demoPolicy } from "./policy";
export { ACTION_IDS, registry } from "./registry";
export { createRulesProvider, rules } from "./rules";
export { specs } from "./specs";
export { templates } from "./templates";
export { tree } from "./tree";

/** The demo's morph instance. Works in the browser (RemoteProvider) and in tests (Rules/Replay). */
export function createDemoMorph(opts: {
  provider: DecisionProvider;
  traceSink?: TraceSink;
  gate?: Partial<GateConfig>;
  clock?: () => number;
  idGen?: () => string;
  traceFull?: boolean;
  lensBudget?: "throw" | "warn";
}) {
  const cfg: MorphConfig = {
    registry,
    templates,
    tree,
    specs,
    policy: demoPolicy,
    provider: opts.provider,
  };
  if (opts.traceSink) cfg.traceSink = opts.traceSink;
  if (opts.gate) cfg.gate = opts.gate;
  if (opts.clock) cfg.clock = opts.clock;
  if (opts.idGen) cfg.idGen = opts.idGen;
  if (opts.traceFull !== undefined) cfg.traceFull = opts.traceFull;
  if (opts.lensBudget) cfg.lensBudget = opts.lensBudget;
  return createMorph(cfg);
}
