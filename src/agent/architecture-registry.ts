import { ARCHITECTURE_DEFINITIONS, type RunConfigurationId } from "./architecture-definitions";
import type { ExperimentRunner } from "../experiments/run-experiment";
import type { ModelProvider } from "./model-provider";
import { SingleAgent, structuredPrompt } from "./single-agent";
import { TwoAgentHandoffRunner } from "./two-agent-handoff-runner";
import type { Tool } from "../tools/tool";

export type RunnerContext = { createProviderFor(slot: string): ModelProvider; createTools(): readonly Tool[] };
const factories: Record<RunConfigurationId, (context: RunnerContext) => ExperimentRunner> = {
  baseline: (ctx) => new SingleAgent(ctx.createProviderFor("primary"), ctx.createTools()),
  structured: (ctx) => new SingleAgent(ctx.createProviderFor("primary"), ctx.createTools(), structuredPrompt),
  "handoff-default": (ctx) => new TwoAgentHandoffRunner(
    new SingleAgent(ctx.createProviderFor("analyst"), ctx.createTools()),
    new SingleAgent(ctx.createProviderFor("finalizer"), ctx.createTools())),
};
export function createArchitectureRunner(id: RunConfigurationId, context: RunnerContext): ExperimentRunner {
  if (!ARCHITECTURE_DEFINITIONS[id].enabled) throw new Error("Architecture is not enabled.");
  return factories[id](context);
}
