import type { Experiment, ExperimentEvent, EvaluationResult } from "./types";

type LifecycleSummary = {
  valid: boolean;
  lifecycleEventCount: number;
  toolNames: string[];
  successfulExecutions: number;
  failedExecutions: number;
};

export function evaluateScenario(
  scenarioId: string,
  experiment: Experiment,
  events: readonly ExperimentEvent[],
): EvaluationResult | undefined {
  const lifecycle = summarizeToolLifecycle(events);
  const finalText = experiment.output?.text ?? "";

  switch (scenarioId) {
    case "direct-text": {
      const passed = experiment.status === "completed" && finalText.trim().length > 0 && lifecycle.lifecycleEventCount === 0;
      return {
        passed,
        reason: passed
          ? "Experiment completed with non-empty text and no tool executions."
          : "Expected a completed text response without tool activity.",
      };
    }
    case "calculator-once": {
      const passed =
        experiment.status === "completed" &&
        hasSuccessfulCalculatorExecutions(lifecycle, 1) &&
        containsNumericToken(finalText, "96");
      return {
        passed,
        reason: passed
          ? "Experiment completed with one successful calculator execution and included 96."
          : "Expected one successful calculator execution and final text containing 96.",
      };
    }
    case "calculator-three-steps": {
      const passed =
        experiment.status === "completed" &&
        hasSuccessfulCalculatorExecutions(lifecycle, 3) &&
        ["5", "15", "24"].every((value) => containsNumericToken(finalText, value));
      return {
        passed,
        reason: passed
          ? "Experiment completed with three successful calculator executions and included 5, 15, and 24."
          : "Expected three successful calculator executions and final text containing 5, 15, and 24.",
      };
    }
    case "unknown-tool-failure": {
      const passed = experiment.status === "failed" && lifecycle.lifecycleEventCount === 0;
      return {
        passed,
        reason: passed
          ? "Experiment failed safely before any tool execution."
          : "Expected the experiment to fail before any tool execution.",
      };
    }
    default:
      return undefined;
  }
}

function hasSuccessfulCalculatorExecutions(lifecycle: LifecycleSummary, expectedCount: number): boolean {
  return (
    lifecycle.valid &&
    lifecycle.toolNames.length === expectedCount &&
    lifecycle.toolNames.every((toolName) => toolName === "calculator") &&
    lifecycle.successfulExecutions === expectedCount &&
    lifecycle.failedExecutions === 0
  );
}

function summarizeToolLifecycle(events: readonly ExperimentEvent[]): LifecycleSummary {
  const summary: LifecycleSummary = {
    valid: true,
    lifecycleEventCount: 0,
    toolNames: [],
    successfulExecutions: 0,
    failedExecutions: 0,
  };
  let pendingToolName: string | undefined;

  for (const event of events) {
    if (event.type === "tool.started") {
      summary.lifecycleEventCount += 1;
      if (pendingToolName !== undefined) {
        summary.valid = false;
      }
      summary.toolNames.push(event.toolName);
      pendingToolName = event.toolName;
      continue;
    }

    if (event.type === "tool.completed" || event.type === "tool.failed") {
      summary.lifecycleEventCount += 1;
      if (pendingToolName !== event.toolName) {
        summary.valid = false;
      }

      if (event.type === "tool.completed") {
        summary.successfulExecutions += 1;
      } else {
        summary.failedExecutions += 1;
      }
      pendingToolName = undefined;
    }
  }

  if (pendingToolName !== undefined) {
    summary.valid = false;
  }

  return summary;
}

function containsNumericToken(text: string, expectedValue: string): boolean {
  const escapedValue = expectedValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_.-])${escapedValue}(?![\\p{L}\\p{N}]|\\.\\d)`, "u");
  return pattern.test(text);
}
