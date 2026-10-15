import { describe, expect, it, vi } from "vitest";
import type { ModelProvider } from "../agent/model-provider";
import { FakeModelProvider } from "../agent/providers/fake-model-provider";
import { SingleAgent } from "../agent/single-agent";
import { TwoAgentHandoffRunner } from "../agent/two-agent-handoff-runner";
import { CalculatorTool } from "../tools/calculator-tool";
import type { Tool } from "../tools/tool";
import { runExperiment } from "./run-experiment";
import type { ExperimentEvent } from "./types";

/**
 * Collects events except model call events. These ordering tests are about tool and agent lifecycle;
 * model call events have their own tests below.
 */
function withoutModelEvents(events: ExperimentEvent[]): (event: ExperimentEvent) => void {
  return (event) => {
    if (!event.type.startsWith("model.")) events.push(event);
  };
}

describe("runExperiment", () => {
  it("emits the scoped Analyst-to-Finalizer lifecycle in order while retaining aggregate events", async () => {
    const events: ExperimentEvent[] = [];
    const analystText = "Thermostats compare measured temperature with a target.";
    const finalizerText = "A thermostat compares room temperature with its target and controls heating or cooling.";
    const agent = new TwoAgentHandoffRunner(
      new SingleAgent(new FakeModelProvider([{ type: "text", text: analystText }])),
      new SingleAgent(new FakeModelProvider([{ type: "text", text: finalizerText }])),
    );

    const experiment = await runExperiment("Explain a thermostat.", agent, withoutModelEvents(events));

    expect(experiment.status).toBe("completed");
    expect(experiment.output).toEqual({ type: "text", text: finalizerText });
    expect(events.map((event) => event.type)).toEqual([
      "experiment.started",
      "agent.started",
      "agent.lifecycle",
      "agent.lifecycle",
      "handoff.completed",
      "agent.lifecycle",
      "agent.lifecycle",
      "agent.completed",
      "experiment.completed",
    ]);
    expect(events[2]).toMatchObject({ type: "agent.lifecycle", agentId: "analyst", phase: "started" });
    expect(events[3]).toMatchObject({ type: "agent.lifecycle", agentId: "analyst", phase: "completed", output: analystText });
    expect(events[4]).toMatchObject({ type: "handoff.completed", fromAgentId: "analyst", toAgentId: "finalizer" });
    expect(events[5]).toMatchObject({ type: "agent.lifecycle", agentId: "finalizer", phase: "started" });
    expect(events[6]).toMatchObject({ type: "agent.lifecycle", agentId: "finalizer", phase: "completed", output: finalizerText });
    expect(events[7]).toMatchObject({ type: "agent.completed", output: { text: finalizerText } });
    expect(events.every((event) => event.experimentId === experiment.id)).toBe(true);
  });

  it("reports Analyst failure safely before experiment.failed without handoff or Finalizer start", async () => {
    const events: ExperimentEvent[] = [];
    const rawError = "private provider error and continuation identifier";
    const failingAnalyst = new SingleAgent({
      async generateResponse() { throw new Error(rawError); },
      async continueAfterToolCall() { throw new Error(rawError); },
    });
    const runner = new TwoAgentHandoffRunner(failingAnalyst, new SingleAgent(new FakeModelProvider()));

    const experiment = await runExperiment("Explain a thermostat.", runner, withoutModelEvents(events));

    expect(experiment.status).toBe("failed");
    expect(events.map((event) => event.type)).toEqual([
      "experiment.started",
      "agent.started",
      "agent.lifecycle",
      "agent.lifecycle",
      "experiment.failed",
    ]);
    expect(events[3]).toMatchObject({
      type: "agent.lifecycle",
      agentId: "analyst",
      phase: "failed",
      failureCode: "agent_execution_failed",
    });
    expect(events.some((event) => event.type.startsWith("handoff."))).toBe(false);
    expect(events.some((event) => event.type === "agent.lifecycle" && event.agentId === "finalizer")).toBe(false);
    expect(JSON.stringify(events)).not.toContain(rawError);
  });

  it("reports empty Analyst output as completed followed by a safe handoff failure", async () => {
    const events: ExperimentEvent[] = [];
    const runner = new TwoAgentHandoffRunner(
      new SingleAgent(new FakeModelProvider([{ type: "text", text: " \n " }])),
      new SingleAgent(new FakeModelProvider([{ type: "text", text: "Must not run." }])),
    );

    const experiment = await runExperiment("Explain a thermostat.", runner, withoutModelEvents(events));

    expect(experiment.status).toBe("failed");
    expect(events.map((event) => event.type)).toEqual([
      "experiment.started",
      "agent.started",
      "agent.lifecycle",
      "agent.lifecycle",
      "handoff.failed",
      "experiment.failed",
    ]);
    expect(events[3]).toMatchObject({ type: "agent.lifecycle", agentId: "analyst", phase: "completed", output: " \n " });
    expect(events[4]).toMatchObject({
      type: "handoff.failed",
      fromAgentId: "analyst",
      toAgentId: "finalizer",
      failureCode: "invalid_handoff",
    });
    expect(events.some((event) => event.type === "agent.lifecycle" && event.agentId === "finalizer")).toBe(false);
  });

  it("reports Finalizer failure after handoff and before experiment.failed", async () => {
    const events: ExperimentEvent[] = [];
    const rawError = "private finalizer SDK details";
    const runner = new TwoAgentHandoffRunner(
      new SingleAgent(new FakeModelProvider([{ type: "text", text: "Useful Analyst notes." }])),
      new SingleAgent({
        async generateResponse() { throw new Error(rawError); },
        async continueAfterToolCall() { throw new Error(rawError); },
      }),
    );

    const experiment = await runExperiment("Explain a thermostat.", runner, withoutModelEvents(events));

    expect(experiment.status).toBe("failed");
    expect(events.map((event) => event.type)).toEqual([
      "experiment.started",
      "agent.started",
      "agent.lifecycle",
      "agent.lifecycle",
      "handoff.completed",
      "agent.lifecycle",
      "agent.lifecycle",
      "experiment.failed",
    ]);
    expect(events[6]).toMatchObject({
      type: "agent.lifecycle",
      agentId: "finalizer",
      phase: "failed",
      failureCode: "agent_execution_failed",
    });
    expect(JSON.stringify(events)).not.toContain(rawError);
  });

  it("attributes each agent's tool events without exposing tool data or call IDs", async () => {
    const events: ExperimentEvent[] = [];
    const privateInputA = "private analyst tool input";
    const privateOutputA = "private analyst tool output";
    const privateInputB = "private finalizer tool input";
    const privateOutputB = "private finalizer tool output";
    const privateCallIdA = "private-analyst-call-id";
    const privateCallIdB = "private-finalizer-call-id";
    const makeTool = (name: string, result: string): Tool => ({
      name,
      description: "Test-only private output tool.",
      async execute() { return result; },
    });
    const analyst = new SingleAgent(new FakeModelProvider([
      { type: "tool_call", callId: privateCallIdA, toolName: "analyst-private-tool", input: privateInputA },
      { type: "text", text: "Analyst contribution." },
    ]), [makeTool("analyst-private-tool", privateOutputA)]);
    const finalizer = new SingleAgent(new FakeModelProvider([
      { type: "tool_call", callId: privateCallIdB, toolName: "finalizer-private-tool", input: privateInputB },
      { type: "text", text: "Finalizer contribution." },
    ]), [makeTool("finalizer-private-tool", privateOutputB)]);

    await runExperiment("Complete this multi-step task.", new TwoAgentHandoffRunner(analyst, finalizer), withoutModelEvents(events));

    expect(events.map((event) => event.type)).toEqual([
      "experiment.started",
      "agent.started",
      "agent.lifecycle",
      "tool.started",
      "tool.completed",
      "agent.lifecycle",
      "handoff.completed",
      "agent.lifecycle",
      "tool.started",
      "tool.completed",
      "agent.lifecycle",
      "agent.completed",
      "experiment.completed",
    ]);
    expect(events.filter((event) => event.type === "tool.started" || event.type === "tool.completed" || event.type === "tool.failed")
      .map((event) => [event.type, "agentId" in event ? event.agentId : undefined])).toEqual([
      ["tool.started", "analyst"],
      ["tool.completed", "analyst"],
      ["tool.started", "finalizer"],
      ["tool.completed", "finalizer"],
    ]);
    const serialized = JSON.stringify(events);
    for (const privateValue of [privateInputA, privateOutputA, privateInputB, privateOutputB, privateCallIdA, privateCallIdB]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it("does not fabricate tool events when an agent requests an unsupported tool", async () => {
    const events: ExperimentEvent[] = [];
    const rawToolName = "unsupported-private-tool";
    const secretInput = "secret unsupported arguments";
    const runner = new TwoAgentHandoffRunner(
      new SingleAgent(new FakeModelProvider([
        { type: "tool_call", callId: "private-call-id", toolName: rawToolName, input: secretInput },
      ]), [new CalculatorTool()]),
      new SingleAgent(new FakeModelProvider([{ type: "text", text: "Must not run." }])),
    );

    const experiment = await runExperiment("Try an unsupported operation.", runner, withoutModelEvents(events));

    expect(experiment.status).toBe("failed");
    expect(events.map((event) => event.type)).toEqual([
      "experiment.started",
      "agent.started",
      "agent.lifecycle",
      "agent.lifecycle",
      "experiment.failed",
    ]);
    expect(events[3]).toMatchObject({ type: "agent.lifecycle", agentId: "analyst", phase: "failed" });
    // The inner category survives the generic handoff error, and the user-facing message stays generic.
    expect(experiment.failureCode).toBe("tool_unavailable");
    expect(events[4]).toMatchObject({ type: "experiment.failed", failureCode: "tool_unavailable" });
    expect(events.some((event) => event.type.startsWith("tool."))).toBe(false);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(rawToolName);
    expect(serialized).not.toContain(secretInput);
    expect(serialized).not.toContain("private-call-id");
  });

  it("emits tool events between agent start and completion for calculator tasks", async () => {
    const events: ExperimentEvent[] = [];
    const agent = new SingleAgent(
      {
        async generateResponse() { return { type: "text", text: "unused" }; },
        async continueAfterToolCall() { return { type: "text", text: "unused" }; },
      },
      [new CalculatorTool()],
    );

    const experiment = await runExperiment("12 * 8", agent, withoutModelEvents(events));

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
    expect(JSON.stringify(events)).not.toContain("agentId");
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

    const experiment = await runExperiment("5 / 0", agent, withoutModelEvents(events));

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
    expect(experiment.failureCode).toBe("tool_failed");
    expect(events[4]).toMatchObject({ type: "experiment.failed", failureCode: "tool_failed" });
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
      withoutModelEvents(events),
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

    const experiment = await runExperiment("Please calculate this.", agent, withoutModelEvents(events));

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
      withoutModelEvents(events),
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
      withoutModelEvents(events),
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
      withoutModelEvents(events),
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
      failureCode: "provider_error",
    });
    expect(experiment.failureCode).toBe("provider_error");
    expect(JSON.stringify(events)).not.toContain(rawProviderError);
  });

  it("falls back to the unknown failure code for errors that are not agent failures", async () => {
    const events: ExperimentEvent[] = [];
    const agent = { run: async () => { throw new Error("raw unexpected error"); } };

    const experiment = await runExperiment("Fail unexpectedly.", agent, withoutModelEvents(events));

    expect(experiment.failureCode).toBe("unknown");
    expect(events.at(-1)).toMatchObject({ type: "experiment.failed", failureCode: "unknown" });
    expect(JSON.stringify(events)).not.toContain("raw unexpected error");
  });

  it("does not attach a failure code to completed experiments", async () => {
    const events: ExperimentEvent[] = [];
    const agent = { run: async () => ({ type: "text" as const, text: "Done." }) };

    const experiment = await runExperiment("Finish.", agent, withoutModelEvents(events));

    expect(experiment).not.toHaveProperty("failureCode");
    expect(events.some((event) => "failureCode" in event)).toBe(false);
  });

  describe("model call events", () => {
    const describeEvent = (event: ExperimentEvent) =>
      event.type === "model.requested" ? `${event.type}:${event.purpose}`
        : event.type === "model.responded" ? `${event.type}:${event.outcome}`
          : event.type;

    it("places each model call around the tool it triggers, in order", async () => {
      const events: ExperimentEvent[] = [];
      const agent = new SingleAgent(new FakeModelProvider([
        { type: "tool_call", callId: "call-1", toolName: "calculator", input: "2 + 3" },
        { type: "text", text: "The sum is 5." },
      ]), [new CalculatorTool()]);

      await runExperiment("Use the calculator.", agent, (event) => events.push(event));

      expect(events.map(describeEvent)).toEqual([
        "experiment.started",
        "agent.started",
        "model.requested:initial",
        "model.responded:tool_call",
        "tool.started",
        "tool.completed",
        "model.requested:after_tool",
        "model.responded:text",
        "agent.completed",
        "experiment.completed",
      ]);
      for (const event of events.filter((item) => item.type === "model.responded")) {
        expect(event).toMatchObject({ durationMs: expect.any(Number) });
        expect((event as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
      }
      expect(events.some((event) => "agentId" in event)).toBe(false);
    });

    it("attributes each model call to the agent that made it, inside that agent's lifecycle", async () => {
      const events: ExperimentEvent[] = [];
      const runner = new TwoAgentHandoffRunner(
        new SingleAgent(new FakeModelProvider([{ type: "text", text: "Analyst notes." }])),
        new SingleAgent(new FakeModelProvider([{ type: "text", text: "Final answer." }])),
      );

      await runExperiment("Explain something.", runner, (event) => events.push(event));

      const timeline = events.map((event) => {
        if (event.type === "agent.lifecycle") return `${event.agentId}:${event.phase}`;
        if (event.type === "model.requested" || event.type === "model.responded") return `${event.agentId}:${describeEvent(event)}`;
        return event.type;
      });
      expect(timeline).toEqual([
        "experiment.started",
        "agent.started",
        "analyst:started",
        "analyst:model.requested:initial",
        "analyst:model.responded:text",
        "analyst:completed",
        "handoff.completed",
        "finalizer:started",
        "finalizer:model.requested:initial",
        "finalizer:model.responded:text",
        "finalizer:completed",
        "agent.completed",
        "experiment.completed",
      ]);
    });

    it("reports a failed provider call as an error response right before experiment.failed", async () => {
      const events: ExperimentEvent[] = [];
      const provider: ModelProvider = {
        async generateResponse() { throw new Error("private provider response"); },
        async continueAfterToolCall() { throw new Error("private provider response"); },
      };

      await runExperiment("Say hello.", new SingleAgent(provider), (event) => events.push(event));

      expect(events.map(describeEvent)).toEqual([
        "experiment.started",
        "agent.started",
        "model.requested:initial",
        "model.responded:error",
        "experiment.failed",
      ]);
      expect(events.at(-1)).toMatchObject({ failureCode: "provider_error" });
      expect(JSON.stringify(events)).not.toContain("private provider response");
    });

    it("keeps prompts, answers, tool data, and call IDs out of model call events", async () => {
      const events: ExperimentEvent[] = [];
      const agent = new SingleAgent(new FakeModelProvider([
        { type: "tool_call", callId: "private-call-id", toolName: "calculator", input: "6 * 7" },
        { type: "text", text: "private final answer" },
      ]), [new CalculatorTool()]);

      await runExperiment("private task text", agent, (event) => events.push(event));

      const modelEvents = JSON.stringify(events.filter((event) => event.type.startsWith("model.")));
      // The tool result "42" is not searched for: event IDs and timestamps can contain those digits by chance.
      for (const secret of ["private task text", "private final answer", "private-call-id", "6 * 7"]) {
        expect(modelEvents).not.toContain(secret);
      }
    });

    it("shows a skipped model, not a model call, when the deterministic calculator path solves the task", async () => {
      const events: ExperimentEvent[] = [];

      await runExperiment("12 * 8", new SingleAgent(new FakeModelProvider(), [new CalculatorTool()]), (event) => events.push(event));

      expect(events.map((event) => event.type)).toEqual([
        "experiment.started",
        "agent.started",
        "model.skipped",
        "tool.started",
        "tool.completed",
        "agent.completed",
        "experiment.completed",
      ]);
      expect(events[2]).toMatchObject({ type: "model.skipped", reason: "deterministic_arithmetic" });
      expect(events.some((event) => event.type === "model.requested" || event.type === "model.responded")).toBe(false);
    });
  });
});
