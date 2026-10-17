import type { ExperimentEvent } from "./types";

export interface ComparisonMetrics {
  modelRequested: number; modelResponded: number;
  toolStarted: number; toolCompleted: number; toolFailed: number;
  knownTokens: { input: number | null; output: number | null; total: number | null };
  unknownUsageCalls: number;
}
/** Known subtotals only. Missing measurements never become measured zero. */
export function comparisonMetrics(events: readonly ExperimentEvent[]): ComparisonMetrics {
  const count = (type: ExperimentEvent["type"]) => events.filter((e) => e.type === type).length;
  const responses = events.filter((e) => e.type === "model.responded");
  const sum = (key: "inputTokens" | "outputTokens" | "totalTokens") => {
    const values = responses.flatMap((e) => typeof e.usage?.[key] === "number" ? [e.usage[key]!] : []);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  return { modelRequested: count("model.requested"), modelResponded: responses.length,
    toolStarted: count("tool.started"), toolCompleted: count("tool.completed"), toolFailed: count("tool.failed"),
    knownTokens: { input: sum("inputTokens"), output: sum("outputTokens"), total: sum("totalTokens") },
    unknownUsageCalls: responses.filter((e) => !e.usage || [e.usage.inputTokens, e.usage.outputTokens, e.usage.totalTokens].some((n) => n == null)).length };
}
