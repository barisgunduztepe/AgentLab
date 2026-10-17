import type { RunConfigurationId } from "../agent/architecture-definitions";
import type { ExperimentRunMetadata } from "./experiment-history";
import type { EvaluationResult, ExperimentEvent, FailureCode } from "./types";
import type { AuditProgress } from "../agent/critic-report";
import type { ComparisonMetrics } from "./comparison-metrics";
export interface ComparisonRunResult {
  configurationId: RunConfigurationId; id: string; status: "completed" | "failed"; durationMs?: number;
  run: ExperimentRunMetadata; output?: { type: "text"; text: string }; errorMessage?: string;
  evaluation?: EvaluationResult; historySaved: boolean;
  /** Present only in the explicit V2 transport. */
  failureCode?: FailureCode; metrics?: ComparisonMetrics; audit?: AuditProgress;
}
export interface ComparisonResult { comparisonId: string; scenarioId: string; runs: ComparisonRunResult[]; comparisonVersion?: 2 }
export type ComparisonFrame =
  | { type: "comparison.started"; comparisonId: string; scenarioId: string; comparisonVersion?: 2; configurations: { configurationId: RunConfigurationId; label: string; run: ExperimentRunMetadata }[] }
  | { type: "comparison.audit"; comparisonId: string; configurationId: RunConfigurationId; audit: AuditProgress }
  | { type: "comparison.event"; comparisonId: string; configurationId: RunConfigurationId; event: ExperimentEvent }
  | { type: "comparison.run.finished"; comparisonId: string; run: ComparisonRunResult }
  | { type: "comparison.finished"; outcome: "completed" | "cancelled"; result: ComparisonResult };
