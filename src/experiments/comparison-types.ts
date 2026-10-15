import type { RunConfigurationId } from "../agent/architecture-definitions";
import type { ExperimentRunMetadata } from "./experiment-history";
import type { EvaluationResult, ExperimentEvent } from "./types";
export interface ComparisonRunResult {
  configurationId: RunConfigurationId; id: string; status: "completed" | "failed"; durationMs?: number;
  run: ExperimentRunMetadata; output?: { type: "text"; text: string }; errorMessage?: string;
  evaluation?: EvaluationResult; historySaved: boolean;
}
export interface ComparisonResult { comparisonId: string; scenarioId: string; runs: ComparisonRunResult[] }
export type ComparisonFrame =
  | { type: "comparison.started"; comparisonId: string; scenarioId: string; configurations: { configurationId: RunConfigurationId; label: string; run: ExperimentRunMetadata }[] }
  | { type: "comparison.event"; comparisonId: string; configurationId: RunConfigurationId; event: ExperimentEvent }
  | { type: "comparison.run.finished"; comparisonId: string; run: ComparisonRunResult }
  | { type: "comparison.finished"; outcome: "completed" | "cancelled"; result: ComparisonResult };
