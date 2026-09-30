import { randomUUID } from "node:crypto";
import type { SingleAgent } from "../agent/single-agent";
import type { Experiment, ExperimentEvent } from "./types";

export async function runExperiment(
  task: string,
  agent: SingleAgent,
  onEvent: (event: ExperimentEvent) => void,
): Promise<Experiment> {
  const id = randomUUID();
  const startedAt = new Date().toISOString();
  const startTimeMs = Date.now();

  onEvent({
    experimentId: id,
    type: "experiment.started",
    occurredAt: startedAt,
  });
  onEvent({
    experimentId: id,
    type: "agent.started",
    occurredAt: new Date().toISOString(),
  });

  let output: string;

  try {
    output = await agent.run(task, (signal) => {
      onEvent({
        experimentId: id,
        occurredAt: new Date().toISOString(),
        ...signal,
      });
    });
  } catch {
    const endedAt = new Date().toISOString();
    const durationMs = Date.now() - startTimeMs;
    const errorMessage = "Agent görevi tamamlayamadı.";

    const failedExperiment: Experiment = {
      id,
      task,
      status: "failed",
      startedAt,
      endedAt,
      durationMs,
      errorMessage,
    };

    onEvent({
      experimentId: id,
      type: "experiment.failed",
      occurredAt: endedAt,
      endedAt,
      durationMs,
      errorMessage,
    });

    return failedExperiment;
  }

  onEvent({
    experimentId: id,
    type: "agent.completed",
    occurredAt: new Date().toISOString(),
    output,
  });

  const endedAt = new Date().toISOString();
  const durationMs = Date.now() - startTimeMs;
  const completedExperiment: Experiment = {
    id,
    task,
    status: "completed",
    startedAt,
    endedAt,
    durationMs,
    output,
  };

  onEvent({
    experimentId: id,
    type: "experiment.completed",
    occurredAt: endedAt,
    endedAt,
    durationMs,
  });

  return completedExperiment;
}
