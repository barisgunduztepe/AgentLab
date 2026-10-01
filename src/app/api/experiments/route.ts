import { createModelProvider } from "../../../agent/create-model-provider";
import type { ModelProvider } from "../../../agent/model-provider";
import { SingleAgent } from "../../../agent/single-agent";
import { runExperiment } from "../../../experiments/run-experiment";
import { evaluateScenario } from "../../../experiments/scenario-evaluator";
import { getScenarioFakeResponses } from "../../../experiments/scenario-fake-fixtures";
import { getScenarioById } from "../../../experiments/scenarios";
import type { ExperimentEvent } from "../../../experiments/types";
import { CalculatorTool } from "../../../tools/calculator-tool";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return Response.json(
      { error: "A non-empty task string is required." },
      { status: 400 },
    );
  }

  const payload = body as Record<string, unknown>;
  const hasTask = "task" in payload;
  const hasScenarioId = "scenarioId" in payload;
  if (hasTask && hasScenarioId) {
    return Response.json(
      { error: "Provide either task or scenarioId, not both." },
      { status: 400 },
    );
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
    return Response.json(
      { error: "A non-empty task string is required." },
      { status: 400 },
    );
  }

  let modelProvider: ModelProvider;

  try {
    const fakeResponses = scenarioId && process.env.AGENTLAB_MODEL_PROVIDER === "fake"
      ? getScenarioFakeResponses(scenarioId)
      : undefined;
    modelProvider = createModelProvider(fakeResponses ? { fakeResponses } : undefined);
  } catch {
    return Response.json({ error: "Experiment provider is not configured." }, { status: 500 });
  }

  const encoder = new TextEncoder();
  let streamCancelled = false;
  const capturedEvents: ExperimentEvent[] = [];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const calculatorTool = new CalculatorTool();
        const agent = new SingleAgent(modelProvider, [calculatorTool]);

        const experiment = await runExperiment(task, agent, (event) => {
          capturedEvents.push(event);
          enqueueEvent(controller, encoder, event, streamCancelled);
        });

        if (scenarioId) {
          const evaluation = evaluateScenario(scenarioId, experiment, capturedEvents);
          if (evaluation) {
            enqueueEvent(controller, encoder, {
              experimentId: experiment.id,
              occurredAt: new Date().toISOString(),
              type: "scenario.evaluated",
              scenarioId,
              evaluation,
            }, streamCancelled);
          }
        }
      } finally {
        if (!streamCancelled) {
          controller.close();
        }
      }
    },
    cancel() {
      streamCancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });
}

function enqueueEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: ExperimentEvent,
  streamCancelled: boolean,
): void {
  if (streamCancelled) {
    return;
  }

  const data = `data: ${JSON.stringify(event)}\n\n`;
  controller.enqueue(encoder.encode(data));
}
