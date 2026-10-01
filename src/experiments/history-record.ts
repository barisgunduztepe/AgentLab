import type { ExperimentHistoryRecord } from "./experiment-history";
import type { EvaluationResult, Experiment, ExperimentEvent } from "./types";

export function toExperimentHistoryRecord(
  experiment: Experiment,
  scenarioId: string | undefined,
  evaluation: EvaluationResult | undefined,
  events: ExperimentEvent[],
  comparison?: { comparisonId: string; configurationId: "baseline" | "structured" },
): ExperimentHistoryRecord {
  if (experiment.status === "running" || !experiment.endedAt || experiment.durationMs === undefined) {
    throw new Error("A terminal experiment must include end timing.");
  }

  return {
    schemaVersion: comparison ? 2 : 1,
    id: experiment.id,
    task: experiment.task,
    status: experiment.status,
    startedAt: experiment.startedAt,
    endedAt: experiment.endedAt,
    durationMs: experiment.durationMs,
    ...(scenarioId === undefined ? {} : { scenarioId }),
    ...(experiment.status === "completed" && experiment.output ? { output: experiment.output } : {}),
    ...(experiment.status === "failed" && experiment.errorMessage ? { errorMessage: experiment.errorMessage } : {}),
    ...(evaluation === undefined ? {} : { evaluation }),
    ...(comparison === undefined ? {} : comparison),
    events: [...events],
  };
}
