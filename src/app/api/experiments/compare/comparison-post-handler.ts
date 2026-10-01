import { randomUUID } from "node:crypto";
import { createComparisonModelProviders } from "../../../../agent/create-model-provider";
import type { ModelProvider, ModelResponse } from "../../../../agent/model-provider";
import { SingleAgent } from "../../../../agent/single-agent";
import {
  experimentHistoryStore,
  type ExperimentHistoryStore,
} from "../../../../experiments/experiment-history";
import { evaluateScenario } from "../../../../experiments/scenario-evaluator";
import { getComparisonFakeResponses } from "../../../../experiments/scenario-fake-fixtures";
import { getScenarioById } from "../../../../experiments/scenarios";
import type { EvaluationResult, Experiment, ExperimentEvent } from "../../../../experiments/types";
import { toExperimentHistoryRecord } from "../../../../experiments/history-record";
import { CalculatorTool } from "../../../../tools/calculator-tool";
import { runExperiment } from "../../../../experiments/run-experiment";

const COMPARABLE_SCENARIO_IDS = new Set([
  "direct-text",
  "calculator-once",
  "calculator-three-steps",
  "unknown-tool-failure",
]);

interface ComparisonRunResult {
  configurationId: "baseline" | "structured";
  id: string;
  status: "completed" | "failed";
  output?: { type: "text"; text: string };
  errorMessage?: string;
  evaluation?: EvaluationResult;
  historySaved: boolean;
}

export function createComparisonPostHandler(
  historyStore: Pick<ExperimentHistoryStore, "append">,
  options: {
    createProviders?: (fixtures?: {
      baseline: readonly ModelResponse[];
      structured: readonly ModelResponse[];
    }) => [ModelProvider, ModelProvider];
    createComparisonId?: () => string;
  } = {},
) {
  return async function handleComparisonPost(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }

    if (typeof body !== "object" || body === null || Array.isArray(body) ||
      typeof (body as Record<string, unknown>).scenarioId !== "string") {
      return Response.json({ error: "A fixed scenarioId is required." }, { status: 400 });
    }

    const scenarioId = ((body as Record<string, string>).scenarioId).trim();
    const scenario = getScenarioById(scenarioId);
    if (!scenario || !COMPARABLE_SCENARIO_IDS.has(scenarioId)) {
      return Response.json({ error: "This scenario cannot be compared." }, { status: 400 });
    }

    let providers: [ModelProvider, ModelProvider];
    try {
      const fixtures = process.env.AGENTLAB_MODEL_PROVIDER === "fake"
        ? getComparisonFakeResponses(scenarioId)
        : undefined;
      providers = (options.createProviders ?? createComparisonModelProviders)(fixtures);
    } catch {
      return Response.json({ error: "Experiment provider is not configured." }, { status: 500 });
    }

    const comparisonId = options.createComparisonId?.() ?? randomUUID();
    const configurations = ["baseline", "structured"] as const;
    const runs: ComparisonRunResult[] = [];
    const tools = [new CalculatorTool()];

    for (const [index, configurationId] of configurations.entries()) {
      const events: ExperimentEvent[] = [];
      const agent = new SingleAgent(providers[index], tools, configurationId);
      const experiment = await runExperiment(scenario.task, agent, (event) => events.push(event));
      const evaluation = evaluateScenario(scenarioId, experiment, events);
      let historySaved = false;
      try {
        await historyStore.append(toExperimentHistoryRecord(
          experiment,
          scenarioId,
          evaluation,
          events,
          { comparisonId, configurationId },
        ));
        historySaved = true;
      } catch {
        console.error("AgentLab experiment history could not be saved.");
      }

      runs.push(toComparisonRunResult(configurationId, experiment, evaluation, historySaved));
    }

    return Response.json({ comparisonId, scenarioId, runs });
  };
}

function toComparisonRunResult(
  configurationId: "baseline" | "structured",
  experiment: Experiment,
  evaluation: EvaluationResult | undefined,
  historySaved: boolean,
): ComparisonRunResult {
  return {
    configurationId,
    id: experiment.id,
    status: experiment.status === "running" ? "failed" : experiment.status,
    ...(experiment.status === "completed" && experiment.output ? { output: experiment.output } : {}),
    ...(experiment.status === "failed" && experiment.errorMessage ? { errorMessage: experiment.errorMessage } : {}),
    ...(evaluation === undefined ? {} : { evaluation }),
    historySaved,
  };
}

export const handleComparisonPost = createComparisonPostHandler(experimentHistoryStore);
