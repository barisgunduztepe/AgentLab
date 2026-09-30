import { describe, expect, it } from "vitest";
import type { ModelProvider } from "../agent/model-provider";
import { SingleAgent } from "../agent/single-agent";
import { CalculatorTool } from "../tools/calculator-tool";
import { runExperiment } from "./run-experiment";
import type { ExperimentEvent } from "./types";

describe("runExperiment", () => {
  it("emits tool events between agent start and completion for calculator tasks", async () => {
    const events: ExperimentEvent[] = [];
    const agent = new SingleAgent(
      { async generateText() { return "unused"; } },
      [new CalculatorTool()],
    );

    const experiment = await runExperiment("12 * 8", agent, (event) => events.push(event));

    expect(experiment.status).toBe("completed");
    expect(experiment.output).toBe("96");
    expect(events.map((event) => event.type)).toEqual([
      "experiment.started",
      "agent.started",
      "tool.started",
      "tool.completed",
      "agent.completed",
      "experiment.completed",
    ]);
    expect(events[2]).toMatchObject({ type: "tool.started", toolName: "calculator" });
    expect(events[3]).toMatchObject({ type: "tool.completed", toolName: "calculator" });
    expect(events.every((event) => event.experimentId === experiment.id)).toBe(true);
    expect(events.some((event) => "input" in event || "toolOutput" in event)).toBe(false);
  });

  it("emits safe tool failure events and preserves the failed experiment result", async () => {
    const events: ExperimentEvent[] = [];
    const rawToolError = "Division by zero is not allowed.";
    const agent = new SingleAgent(
      { async generateText() { return "unused"; } },
      [new CalculatorTool()],
    );

    const experiment = await runExperiment("5 / 0", agent, (event) => events.push(event));

    expect(experiment.status).toBe("failed");
    expect(experiment.errorMessage).toBe("Agent görevi tamamlayamadı.");
    expect(events.map((event) => event.type)).toEqual([
      "experiment.started",
      "agent.started",
      "tool.started",
      "tool.failed",
      "experiment.failed",
    ]);
    expect(events[3]).toMatchObject({ type: "tool.failed", toolName: "calculator" });
    expect(JSON.stringify(experiment)).not.toContain(rawToolError);
    expect(JSON.stringify(events)).not.toContain(rawToolError);
  });

  it("completes an experiment and emits its lifecycle events in order", async () => {
    const task = "Check the successful experiment flow.";
    const output = "Experiment result.";
    const modelProvider: ModelProvider = {
      async generateText() {
        return output;
      },
    };
    const events: ExperimentEvent[] = [];

    const experiment = await runExperiment(
      task,
      new SingleAgent(modelProvider, [new CalculatorTool()]),
      (event) => events.push(event),
    );

    expect(experiment.status).toBe("completed");
    expect(experiment.output).toBe(output);
    expect(experiment.startedAt).toBeTruthy();
    expect(Date.parse(experiment.startedAt)).not.toBeNaN();
    expect(experiment.endedAt).toBeTruthy();
    expect(Date.parse(experiment.endedAt ?? "")).not.toBeNaN();
    expect(experiment.durationMs).toEqual(expect.any(Number));
    expect(experiment.durationMs).toBeGreaterThanOrEqual(0);
    expect(events.map((event) => event.type)).toEqual([
      "experiment.started",
      "agent.started",
      "agent.completed",
      "experiment.completed",
    ]);
    expect(events[2]).toMatchObject({ type: "agent.completed", output });
    expect(events[3]).toMatchObject({
      type: "experiment.completed",
      endedAt: experiment.endedAt,
      durationMs: experiment.durationMs,
    });
  });

  it("returns a safe failed result without leaking provider error details", async () => {
    const rawProviderError = "private provider response and credential details";
    const modelProvider: ModelProvider = {
      async generateText() {
        throw new Error(rawProviderError);
      },
    };
    const events: ExperimentEvent[] = [];

    const experiment = await runExperiment(
      "Check the failed experiment flow.",
      new SingleAgent(modelProvider),
      (event) => events.push(event),
    );

    expect(experiment.status).toBe("failed");
    expect(experiment.errorMessage).toBe("Agent görevi tamamlayamadı.");
    expect(experiment.errorMessage).not.toContain(rawProviderError);
    expect(JSON.stringify(experiment)).not.toContain(rawProviderError);
    expect(events.map((event) => event.type)).toEqual([
      "experiment.started",
      "agent.started",
      "experiment.failed",
    ]);
    expect(events[2]).toMatchObject({
      type: "experiment.failed",
      errorMessage: "Agent görevi tamamlayamadı.",
    });
    expect(JSON.stringify(events)).not.toContain(rawProviderError);
  });
});
