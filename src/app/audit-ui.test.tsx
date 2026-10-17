import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AuditPanel, MetricsPanel } from "./audit-panel";
import { applyComparisonFrame, interruptComparison, comparisonStatusLabel, type ComparisonProgress } from "./comparison-progress";
import { comparisonMetrics } from "../experiments/comparison-metrics";
import type { ExperimentRunMetadata } from "../experiments/experiment-history";

const run: ExperimentRunMetadata = { provider: "fake", model: "fake", architecture: "single-critic", agentConfigurationId: "single-critic-audit-v1", agentConfigurationVersion: 1 };
it("escapes issue text and clearly separates audit-only, FAKE and history limits", () => {
  const markup = renderToStaticMarkup(<AuditPanel run={run} audit={{ phase: "critic", status: "completed", producerModelCalls: 4, criticModelCalls: 1, report: { verdict: "issues_found", issues: [{ kind: "inconsistency", message: '<img src=x onerror="alert(1)">', evidenceId: 1 }] } }} />);
  expect(markup).toContain("&lt;img"); expect(markup).not.toContain("<img");
  for (const label of ["FAKE", "Critic kararı uygulanmadı", "Evaluator bağımsızdır", "issues_found", "sayfa yenilenince kaybolur"]) expect(markup).toContain(label);
  const stored = renderToStaticMarkup(<AuditPanel historical run={run} />);
  expect(stored).toContain("Denetim raporu bu şemada saklanmıyor"); expect(stored).not.toContain("Verdict:");
  expect(renderToStaticMarkup(<AuditPanel audit={{ phase: "critic", status: "invalid_report", producerModelCalls: 1, criticModelCalls: 1 }} />)).toContain("otomatik repair/retry yok");
});
it("labels unknown usage as unknown, and measured zero as zero", () => {
  const empty = renderToStaticMarkup(<MetricsPanel metrics={comparisonMetrics([])} />);
  expect(empty).toContain("Bilinmiyor/Bilinmiyor/Bilinmiyor"); expect(empty).toContain("hesaplanamadı");
  const measured = comparisonMetrics([{ experimentId: "r", occurredAt: "now", type: "model.responded", durationMs: 1, outcome: "text", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }]);
  expect(renderToStaticMarkup(<MetricsPanel metrics={measured} />)).toContain("0/0/0");
});
const started = () => applyComparisonFrame(null, { type: "comparison.started", comparisonId: "c", scenarioId: "s", comparisonVersion: 2, configurations: ["baseline", "structured", "single-critic-audit-v1"].map((id) => ({ configurationId: id as "baseline", label: id, run })) });
it("keeps active/audit/queued rows separate on disconnect and cancellation", () => {
  let state = started();
  state = applyComparisonFrame(state, { type: "comparison.event", comparisonId: "c", configurationId: "baseline", event: { type: "experiment.started", experimentId: "r", occurredAt: "now" } });
  state = applyComparisonFrame(state, { type: "comparison.audit", comparisonId: "c", configurationId: "single-critic-audit-v1", audit: { phase: "producer", status: "not_started", producerModelCalls: 0, criticModelCalls: 0 } });
  const stopped = interruptComparison(state)!;
  expect(stopped.rows.map((row) => row.status)).toEqual(["unknown", "not_started", "not_started"]);
  expect(stopped.rows.slice(1).every((row) => !row.id && !row.result)).toBe(true);
  expect(comparisonStatusLabel(stopped.rows[0].status)).toContain("sonuç bilinmiyor");
  expect(comparisonStatusLabel(stopped.rows[1].status)).toBe("Başlatılmadı");
  const finished = applyComparisonFrame(state, { type: "comparison.finished", outcome: "cancelled", result: { comparisonId: "c", scenarioId: "s", runs: [] } });
  expect(finished.rows[1].status).toBe("not_started");
});
it("keeps completed/FAIL distinct from execution failure and does not overwrite known results on disconnect", () => {
  const state = started();
  const row = { ...state.rows[0], id: "r", status: "completed" as const, result: { configurationId: "baseline" as const, id: "r", status: "completed" as const, run, evaluation: { passed: false, reason: "Format" }, historySaved: true } };
  const value: ComparisonProgress = { ...state, rows: [row, ...state.rows.slice(1)] };
  expect(interruptComparison(value)?.rows[0]).toEqual(row);
  expect(row.result.evaluation.passed).toBe(false); expect(comparisonStatusLabel(row.status)).toBe("Completed");
});
