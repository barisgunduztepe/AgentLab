import type { ComparisonFrame, ComparisonRunResult } from "../experiments/comparison-types";
import type { ExperimentEvent } from "../experiments/types";
import type { RunConfigurationId } from "../agent/architecture-definitions";
import type { ExperimentRunMetadata } from "../experiments/experiment-history";
import type { AuditProgress } from "../agent/critic-report";
export interface ComparisonRow {
  configurationId: RunConfigurationId; label: string; id?: string; run: ExperimentRunMetadata;
  status: "queued" | "running" | "persisting" | "completed" | "failed" | "not_started" | "unknown";
  events: ExperimentEvent[]; result?: ComparisonRunResult; audit?: AuditProgress;
}
export interface ComparisonProgress { comparisonId: string; scenarioId: string; rows: ComparisonRow[]; finished: boolean }
export function applyComparisonFrame(state: ComparisonProgress | null, frame: ComparisonFrame): ComparisonProgress {
  if (frame.type === "comparison.started") {
    if (state) throw new Error("Duplicate comparison start.");
    return { comparisonId: frame.comparisonId, scenarioId: frame.scenarioId, finished: false,
      rows: frame.configurations.map((item) => ({ ...item, status: "queued", events: [] })) };
  }
  const id = frame.type === "comparison.finished" ? frame.result.comparisonId : frame.comparisonId;
  if (!state || state.finished || id !== state.comparisonId) throw new Error("Unexpected comparison frame.");
  if (frame.type === "comparison.finished") return { ...state, finished: true, rows: state.rows.map((row) => row.status === "queued" ? { ...row, status: "not_started" } : row) };
  if (frame.type === "comparison.audit") {
    if (!state.rows.some((row) => row.configurationId === frame.configurationId)) throw new Error("Unknown audit row.");
    return { ...state, rows: state.rows.map((row) => row.configurationId === frame.configurationId ? { ...row, audit: frame.audit } : row) };
  }
  const configurationId = frame.type === "comparison.event" ? frame.configurationId : frame.run.configurationId;
  if (!state.rows.some((row) => row.configurationId === configurationId)) throw new Error("Unknown comparison row.");
  return { ...state, rows: state.rows.map((row) => {
    if (row.configurationId !== configurationId) return row;
    if (frame.type === "comparison.run.finished") {
      if (row.id !== frame.run.id) throw new Error("Mismatched run identity.");
      return { ...row, result: frame.run, audit: frame.run.audit ?? row.audit, status: frame.run.status };
    }
    if (row.id && row.id !== frame.event.experimentId) throw new Error("Mismatched event identity.");
    return { ...row, id: frame.event.experimentId, events: [...row.events, frame.event],
      status: frame.event.type === "experiment.completed" || frame.event.type === "experiment.failed" ? "persisting" : row.status === "queued" ? "running" : row.status };
  }) };
}

/** A disconnected browser cannot infer the server's terminal/persistence result. */
export function interruptComparison(state: ComparisonProgress | null): ComparisonProgress | null {
  if (!state || state.finished) return state;
  return { ...state, finished: true, rows: state.rows.map((row) => row.result ? row :
    { ...row, status: row.status === "queued" ? "not_started" : "unknown" }) };
}
export function comparisonStatusLabel(status: ComparisonRow["status"]): string {
  return ({ queued: "Sırada", running: "Running", persisting: "Kaydediliyor", completed: "Completed", failed: "Failed", not_started: "Başlatılmadı", unknown: "Bağlantı kesildi / sonuç bilinmiyor" })[status];
}
