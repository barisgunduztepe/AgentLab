import { createModelProvider } from "../../../agent/create-model-provider";
import type { ModelProvider } from "../../../agent/model-provider";
import { SingleAgent } from "../../../agent/single-agent";
import { TwoAgentHandoffRunner } from "../../../agent/two-agent-handoff-runner";
import { getHandoffFakeFixtures } from "../../../experiments/handoff-fake-fixtures";
import {
  experimentHistoryStore,
  type ExperimentHistoryStore,
  type ExperimentRunMetadata,
} from "../../../experiments/experiment-history";
import { createRunMetadata } from "../../../experiments/run-metadata";
import { toExperimentHistoryRecord } from "../../../experiments/history-record";
import { runExperiment } from "../../../experiments/run-experiment";
import { evaluateScenario } from "../../../experiments/scenario-evaluator";
import { getScenarioFakeResponses } from "../../../experiments/scenario-fake-fixtures";
import { getScenarioById } from "../../../experiments/scenarios";
import type { EvaluationResult, ExperimentEvent } from "../../../experiments/types";
import { CalculatorTool } from "../../../tools/calculator-tool";

export function createExperimentPostHandler(historyStore: Pick<ExperimentHistoryStore, "append">) {
  return async function handleExperimentPost(request: Request): Promise<Response> {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }

    if (typeof body !== "object" || body === null) {
      return Response.json({ error: "A non-empty task string is required." }, { status: 400 });
    }

    const payload = body as Record<string, unknown>;
    const hasTask = "task" in payload;
    const hasScenarioId = "scenarioId" in payload;
    if (hasTask && hasScenarioId) {
      return Response.json({ error: "Provide either task or scenarioId, not both." }, { status: 400 });
    }

    let task: string;
    let scenarioId: string | undefined;

    if (hasScenarioId) {
      if (typeof payload.scenarioId !== "string" || payload.scenarioId.trim().length === 0) {
        return Response.json({ error: "A non-empty scenarioId string is required." }, { status: 400 });
      }

      const requestedScenarioId = payload.scenarioId.trim();
      scenarioId = requestedScenarioId;
      const scenario = getScenarioById(requestedScenarioId);
      if (!scenario) {
        return Response.json({ error: "Unknown scenario." }, { status: 400 });
      }
      task = scenario.task;
    } else if (hasTask && typeof payload.task === "string" && payload.task.trim().length > 0) {
      task = payload.task.trim();
    } else {
      return Response.json({ error: "A non-empty task string is required." }, { status: 400 });
    }

    let modelProviders: ModelProvider[];
    let run: ExperimentRunMetadata;

    try {
      if (scenarioId === "analyst-finalizer-handoff") {
        const handoffFixtures = process.env.AGENTLAB_MODEL_PROVIDER === "fake"
          ? getHandoffFakeFixtures()
          : undefined;
        modelProviders = [
          createModelProvider(handoffFixtures ? { fakeResponses: handoffFixtures.analyst } : undefined),
          createModelProvider(handoffFixtures ? { fakeResponses: handoffFixtures.finalizer } : undefined),
        ];
      } else {
        const fakeResponses = scenarioId && process.env.AGENTLAB_MODEL_PROVIDER === "fake"
          ? getScenarioFakeResponses(scenarioId)
          : undefined;
        modelProviders = [createModelProvider(fakeResponses ? { fakeResponses } : undefined)];
      }
      run = createRunMetadata(scenarioId === "analyst-finalizer-handoff"
        ? { architecture: "handoff", agentConfigurationId: "handoff-default" }
        : { architecture: "single", agentConfigurationId: "baseline" });
    } catch {
      return Response.json({ error: "Experiment provider is not configured." }, { status: 500 });
    }

    const encoder = new TextEncoder();
    let streamCancelled = false;
    const runController = new AbortController();
    const disconnect = () => { streamCancelled = true; runController.abort(); };
    request.signal.addEventListener("abort", disconnect, { once: true });
    if (request.signal.aborted) disconnect();
    const capturedEvents: ExperimentEvent[] = [];

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const sendEvent = (event: ExperimentEvent) => {
          capturedEvents.push(event);
          try { enqueueEvent(controller, encoder, event, streamCancelled); }
          catch { disconnect(); }
        };
        // Do not return the run promise: reader cancellation must work while it is pending.
        void (async () => {
        try {
          const agent = scenarioId === "analyst-finalizer-handoff"
            ? new TwoAgentHandoffRunner(
                new SingleAgent(modelProviders[0], [new CalculatorTool()]),
                new SingleAgent(modelProviders[1], [new CalculatorTool()]),
              )
            : new SingleAgent(modelProviders[0], [new CalculatorTool()]);

          const experiment = await runExperiment(task, agent, sendEvent, { signal: runController.signal });

          let evaluation: EvaluationResult | undefined;
          if (scenarioId) {
            evaluation = evaluateScenario(scenarioId, experiment, capturedEvents);
            if (evaluation) {
              const evaluationEvent: ExperimentEvent = {
                experimentId: experiment.id,
                occurredAt: new Date().toISOString(),
                type: "scenario.evaluated",
                scenarioId,
                evaluation,
              };
              sendEvent(evaluationEvent);
            }
          }

          try {
            await historyStore.append(toExperimentHistoryRecord(experiment, scenarioId, evaluation, capturedEvents, run));
          } catch {
            // Execution succeeded or failed independently; keep storage details and user data private.
            console.error("AgentLab experiment history could not be saved.");
          }
        } catch {
          if (!streamCancelled) controller.error(new Error("Experiment stream failed."));
          streamCancelled = true;
        } finally {
          request.signal.removeEventListener("abort", disconnect);
          if (!streamCancelled) controller.close();
        }
        })();
      },
      cancel() { disconnect(); },
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-cache",
        "Content-Type": "text/event-stream; charset=utf-8",
      },
    });
  };
}

export const handleExperimentPost = createExperimentPostHandler(experimentHistoryStore);

function enqueueEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: ExperimentEvent,
  streamCancelled: boolean,
): void {
  if (streamCancelled) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  controller.enqueue(encoder.encode(data));
}
