import type { AuditProgress } from "../agent/critic-report";
import type { RunResult } from "./run-service";
import type { ExperimentEvent } from "./types";
import type { ComparisonMetrics } from "./comparison-metrics";
/** Explicit runVersion:2 only; never stored as history events. */
export type SingleRunFrame =
  | { type: "run.started"; run: RunResult["run"] }
  | { type: "run.event"; event: ExperimentEvent }
  | { type: "run.audit"; audit: AuditProgress }
  | { type: "run.finished"; result: Omit<RunResult, "events"> & { metrics: ComparisonMetrics } };
