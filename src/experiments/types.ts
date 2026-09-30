export type ExperimentStatus = "running" | "completed" | "failed";

export type ExperimentEventType =
  | "experiment.started"
  | "agent.started"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "agent.completed"
  | "experiment.completed"
  | "experiment.failed";

export interface Experiment {
  id: string;
  task: string;
  status: ExperimentStatus;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  output?: string;
  errorMessage?: string;
}

interface ExperimentEventBase {
  experimentId: string;
  occurredAt: string;
}

export type ExperimentEvent =
  | (ExperimentEventBase & { type: "experiment.started" })
  | (ExperimentEventBase & { type: "agent.started" })
  | (ExperimentEventBase & { type: "tool.started"; toolName: string })
  | (ExperimentEventBase & { type: "tool.completed"; toolName: string })
  | (ExperimentEventBase & { type: "tool.failed"; toolName: string })
  | (ExperimentEventBase & { type: "agent.completed"; output: string })
  | (ExperimentEventBase & {
      type: "experiment.completed";
      endedAt: string;
      durationMs: number;
    })
  | (ExperimentEventBase & {
      type: "experiment.failed";
      endedAt: string;
      durationMs: number;
      errorMessage: string;
    });
