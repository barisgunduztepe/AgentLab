import { describe, expect, it, vi } from "vitest";
import type { ModelProvider } from "../agent/model-provider";
import { FakeModelProvider } from "../agent/providers/fake-model-provider";
import { SingleAgent } from "../agent/single-agent";
import { CalculatorTool } from "../tools/calculator-tool";
import type { Tool } from "../tools/tool";
import { runExperiment } from "./run-experiment";
import type { ExperimentEvent } from "./types";

describe("runExperiment", () => {
  it("emits tool events between agent start and completion for calculator tasks", async () => {
    const events: ExperimentEvent[] = [];
    const agent = new SingleAgent(
      {
        async generateResponse() { return { type: "text", text: "unused" }; },
        async continueAfterToolCall() { return { type: "text", text: "unused" }; },
      },
      [new CalculatorTool()],
    );

    const experiment = await runExperiment("12 * 8", agent, (event) => events.push(event));

    expect(experiment.status).toBe("completed");
    expect(experiment.output).toEqual({ type: "text", text: "96" });
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
      {
        async generateResponse() { return { type: "text", text: "unused" }; },
        async continueAfterToolCall() { return { type: "text", text: "unused" }; },
      },
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
    const output = { type: "text" as const, text: "Experiment result." };
    const modelProvider: ModelProvider = {
      async generateResponse() {
        return output;
      },
      async continueAfterToolCall() {
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

  it.each([
    { toolName: "unknown-tool-internal", privateValue: "unknown-tool-internal" },
    { toolName: "   ", privateValue: "Tool call is invalid." },
  ])("fails safely for an invalid or unknown tool request without starting a tool", async ({ toolName, privateValue }) => {
    const events: ExperimentEvent[] = [];
    const agent = new SingleAgent(new FakeModelProvider([
      { type: "tool_call", callId: "fake-call", toolName, input: "sensitive input" },
    ]), [new CalculatorTool()]);

    const experiment = await runExperiment("Please calculate this.", agent, (event) => events.push(event));

    expect(experiment.status).toBe("failed");
    expect(experiment.errorMessage).toBe("Agent görevi tamamlayamadı.");
    expect(events.map((event) => event.type)).toEqual([
      "experiment.started",
      "agent.started",
      "experiment.failed",
    ]);
    expect(JSON.stringify(experiment)).not.toContain(privateValue);
    expect(JSON.stringify(events)).not.toContain(privateValue);
    expect(JSON.stringify(events)).not.toContain("sensitive input");
  });

  it("does not continue the provider after an allowed tool fails", async () => {
    const rawToolError = "private tool failure details";
    const events: ExperimentEvent[] = [];
    const provider = new FakeModelProvider([
      { type: "tool_call", callId: "fake-call", toolName: "failing", input: "secret arguments" },
      { type: "text", text: "This response must not be requested." },
    ]);
    const continueAfterToolCall = vi.spyOn(provider, "continueAfterToolCall");
    const failingTool: Tool = {
      name: "failing",
      description: "Fails in a controlled test.",
      async execute() {
        throw new Error(rawToolError);
      },
    };

    const experiment = await runExperiment(
      "Run the failing tool.",
      new SingleAgent(provider, [failingTool]),
      (event) => events.push(event),
    );

    expect(experiment.status).toBe("failed");
    expect(experiment.errorMessage).toBe("Agent görevi tamamlayamadı.");
    expect(continueAfterToolCall).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual([
      "experiment.started",
      "agent.started",
      "tool.started",
      "tool.failed",
      "experiment.failed",
    ]);
    expect(JSON.stringify(experiment)).not.toContain(rawToolError);
    expect(JSON.stringify(events)).not.toContain("secret arguments");
    expect(JSON.stringify(events)).not.toContain(rawToolError);
  });

  it("keeps structured tool input and result out of lifecycle events", async () => {
    const privateInput = "private input value";
    const privateResult = "private tool result value";
    const events: ExperimentEvent[] = [];
    const provider = new FakeModelProvider([
      { type: "tool_call", callId: "fake-call", toolName: "private-tool", input: privateInput },
      { type: "text", text: "Task completed." },
    ]);
    const continueAfterToolCall = vi.spyOn(provider, "continueAfterToolCall");
    const tool: Tool = {
      name: "private-tool",
      description: "Returns private test data.",
      async execute() {
        return privateResult;
      },
    };

    const experiment = await runExperiment(
      "Use the private tool.",
      new SingleAgent(provider, [tool]),
      (event) => events.push(event),
    );

    expect(experiment.status).toBe("completed");
    expect(experiment.output).toEqual({ type: "text", text: "Task completed." });
    expect(continueAfterToolCall).toHaveBeenCalledExactlyOnceWith("fake-call", privateResult);
    expect(JSON.stringify(events)).not.toContain(privateInput);
    expect(JSON.stringify(events)).not.toContain(privateResult);
    expect(events.map((event) => event.type)).toEqual([
      "experiment.started",
      "agent.started",
      "tool.started",
      "tool.completed",
      "agent.completed",
      "experiment.completed",
    ]);
  });

  it("returns a safe failed result without leaking provider error details", async () => {
    const rawProviderError = "private provider response and credential details";
    const modelProvider: ModelProvider = {
      async generateResponse() {
        throw new Error(rawProviderError);
      },
      async continueAfterToolCall() {
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
