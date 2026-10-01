import { describe, expect, it } from "vitest";
import { evaluateScenario } from "./scenario-evaluator";
import type { Experiment, ExperimentEvent } from "./types";

function experiment(
  status: Experiment["status"],
  text?: string,
): Experiment {
  return {
    id: "experiment-1",
    task: "fixed task",
    status,
    startedAt: "2026-10-01T00:00:00.000Z",
    ...(status === "completed" ? { output: { type: "text" as const, text: text ?? "" } } : {}),
  };
}

function toolEvents(...types: Array<"tool.started" | "tool.completed" | "tool.failed">): ExperimentEvent[] {
  return types.map((type) => ({
    experimentId: "experiment-1",
    occurredAt: "2026-10-01T00:00:01.000Z",
    type,
    toolName: "calculator",
  }));
}

describe("evaluateScenario", () => {
  it("passes the direct-text scenario for completed non-empty text without tools", () => {
    expect(evaluateScenario("direct-text", experiment("completed", "A useful response."), [])?.passed).toBe(true);
  });

  it("fails direct-text for empty output and unexpected tool activity", () => {
    expect(evaluateScenario("direct-text", experiment("completed", "  "), [])?.passed).toBe(false);
    expect(evaluateScenario("direct-text", experiment("completed", "A response."), toolEvents("tool.started", "tool.completed"))?.passed).toBe(false);
  });

  it("passes one calculator execution with the expected numeric token", () => {
    expect(evaluateScenario(
      "calculator-once",
      experiment("completed", "12 times 8 is 96."),
      toolEvents("tool.started", "tool.completed"),
    )?.passed).toBe(true);
  });

  it("fails one-calculator evaluation for incorrect count, failed lifecycle, or incorrect result", () => {
    expect(evaluateScenario("calculator-once", experiment("completed", "Result: 96."), [])?.passed).toBe(false);
    expect(evaluateScenario(
      "calculator-once",
      experiment("completed", "Result: 96."),
      toolEvents("tool.started", "tool.failed"),
    )?.passed).toBe(false);
    expect(evaluateScenario(
      "calculator-once",
      experiment("completed", "Result: 95."),
      toolEvents("tool.started", "tool.completed"),
    )?.passed).toBe(false);
  });

  it("does not accept 150 as the expected numeric token 15", () => {
    expect(evaluateScenario(
      "calculator-once",
      experiment("completed", "The value is 150."),
      toolEvents("tool.started", "tool.completed"),
    )?.passed).toBe(false);
  });

  it("passes three calculator executions when each succeeds and all expected results are present", () => {
    expect(evaluateScenario(
      "calculator-three-steps",
      experiment("completed", "The results are 5, 15, and 24."),
      toolEvents(
        "tool.started", "tool.completed",
        "tool.started", "tool.completed",
        "tool.started", "tool.completed",
      ),
    )?.passed).toBe(true);
  });

  it("fails three-step evaluation for incorrect count, tool failure, or incorrect numeric results", () => {
    expect(evaluateScenario(
      "calculator-three-steps",
      experiment("completed", "5, 15, and 24."),
      toolEvents("tool.started", "tool.completed", "tool.started", "tool.completed"),
    )?.passed).toBe(false);
    expect(evaluateScenario(
      "calculator-three-steps",
      experiment("completed", "5, 15, and 24."),
      toolEvents(
        "tool.started", "tool.completed",
        "tool.started", "tool.failed",
        "tool.started", "tool.completed",
      ),
    )?.passed).toBe(false);
    expect(evaluateScenario(
      "calculator-three-steps",
      experiment("completed", "5, 150, and 24."),
      toolEvents(
        "tool.started", "tool.completed",
        "tool.started", "tool.completed",
        "tool.started", "tool.completed",
      ),
    )?.passed).toBe(false);
  });

  it("passes safe failure while keeping execution failure distinct from evaluation", () => {
    const result = evaluateScenario("unknown-tool-failure", experiment("failed"), []);

    expect(result).toEqual({
      passed: true,
      reason: "Experiment failed safely before any tool execution.",
    });
    expect(evaluateScenario(
      "unknown-tool-failure",
      experiment("failed"),
      toolEvents("tool.started", "tool.failed"),
    )?.passed).toBe(false);
  });

  it("does not pass the safe-failure scenario when execution completed", () => {
    expect(evaluateScenario("unknown-tool-failure", experiment("completed", "Done."), [])?.passed).toBe(false);
  });

  it("does not evaluate unrecognized scenario IDs", () => {
    expect(evaluateScenario("unknown", experiment("completed", "Done."), [])).toBeUndefined();
  });

  it("ignores scoped agent and handoff events when evaluating existing single-agent criteria", () => {
    const events: ExperimentEvent[] = [
      { experimentId: "experiment-1", occurredAt: "2026-10-01T00:00:00.000Z", type: "agent.lifecycle", agentId: "analyst", phase: "started" },
      { experimentId: "experiment-1", occurredAt: "2026-10-01T00:00:01.000Z", type: "agent.lifecycle", agentId: "analyst", phase: "completed", output: "Notes." },
      { experimentId: "experiment-1", occurredAt: "2026-10-01T00:00:02.000Z", type: "handoff.completed", fromAgentId: "analyst", toAgentId: "finalizer" },
      ...toolEvents("tool.started", "tool.completed"),
    ];

    expect(evaluateScenario("calculator-once", experiment("completed", "Result: 96."), events)?.passed).toBe(true);
  });
});
