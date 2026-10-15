import { randomUUID } from "node:crypto";
import { failureCodeOf } from "../agent/agent-failure";
import type { ToolLifecycleSignal } from "../agent/single-agent";
import type { AgentId, AgentSignal } from "../agent/two-agent-handoff-runner";
import type { Experiment, ExperimentEvent, ExperimentOutput } from "./types";

type ExperimentRunner = {
  run(
    task: string,
    onToolLifecycle?: (signal: ToolLifecycleSignal & { agentId?: AgentId }) => void,
    onLifecycle?: (signal: AgentSignal) => void,
  ): Promise<ExperimentOutput>;
};

export async function runExperiment(
  task: string,
  agent: ExperimentRunner,
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

  let output: ExperimentOutput;

  try {
    const response = await agent.run(
      task,
      (signal) => {
        onEvent({
          experimentId: id,
          occurredAt: new Date().toISOString(),
          ...signal,
        });
      },
      (signal) => {
        onEvent({
          experimentId: id,
          occurredAt: new Date().toISOString(),
          ...signal,
        });
      },
    );
    output = response;
  } catch (error) {
    const endedAt = new Date().toISOString();
    const durationMs = Date.now() - startTimeMs;
    const errorMessage = "Agent görevi tamamlayamadı.";
    const failureCode = failureCodeOf(error);

    const failedExperiment: Experiment = {
      id,
      task,
      status: "failed",
      startedAt,
      endedAt,
      durationMs,
      errorMessage,
      failureCode,
    };

    onEvent({
      experimentId: id,
      type: "experiment.failed",
      occurredAt: endedAt,
      endedAt,
      durationMs,
      errorMessage,
      failureCode,
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
