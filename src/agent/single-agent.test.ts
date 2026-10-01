import { describe, expect, it, vi } from "vitest";
import type { ModelProvider, ModelResponse } from "./model-provider";
import { FakeModelProvider } from "./providers/fake-model-provider";
import { RetryingModelProvider } from "./providers/retrying-model-provider";
import { RetryableProviderError } from "./retryable-provider-error";
import { SingleAgent, STRUCTURED_AGENT_INSTRUCTION, type ToolLifecycleSignal } from "./single-agent";
import { CalculatorTool } from "../tools/calculator-tool";
import type { Tool } from "../tools/tool";

const fourthToolRequestFixture: readonly ModelResponse[] = [
  { type: "tool_call", callId: "call-1", toolName: "counted", input: "one" },
  { type: "tool_call", callId: "call-2", toolName: "counted", input: "two" },
  { type: "tool_call", callId: "call-3", toolName: "counted", input: "three" },
  { type: "tool_call", callId: "call-4", toolName: "counted", input: "four" },
];

describe("SingleAgent", () => {
  const unusedContinuation = async () => ({ type: "text" as const, text: "unused" });

  it("uses the injected calculator for arithmetic tasks", async () => {
    const generateResponse = vi.fn(async () => ({ type: "text" as const, text: "unused" }));
    const agent = new SingleAgent({ generateResponse, continueAfterToolCall: unusedContinuation }, [new CalculatorTool()]);

    await expect(agent.run("12 * 8")).resolves.toEqual({ type: "text", text: "96" });
    expect(generateResponse).not.toHaveBeenCalled();
  });

  it("emits tool lifecycle signals around a successful calculator call", async () => {
    const signals: ToolLifecycleSignal[] = [];
    const agent = new SingleAgent({ generateResponse: async () => ({ type: "text", text: "unused" }), continueAfterToolCall: unusedContinuation }, [new CalculatorTool()]);

    await expect(agent.run("12 * 8", (signal) => signals.push(signal))).resolves.toEqual({ type: "text", text: "96" });
    expect(signals).toEqual([
      { type: "tool.started", toolName: "calculator" },
      { type: "tool.completed", toolName: "calculator" },
    ]);
  });

  it("emits a failed tool lifecycle signal and rethrows tool errors", async () => {
    const signals: ToolLifecycleSignal[] = [];
    const rawToolError = "Division by zero is not allowed.";
    const agent = new SingleAgent({ generateResponse: async () => ({ type: "text", text: "unused" }), continueAfterToolCall: unusedContinuation }, [new CalculatorTool()]);

    await expect(agent.run("5 / 0", (signal) => signals.push(signal))).rejects.toThrow(rawToolError);
    expect(signals).toEqual([
      { type: "tool.started", toolName: "calculator" },
      { type: "tool.failed", toolName: "calculator" },
    ]);
    expect(JSON.stringify(signals)).not.toContain(rawToolError);
  });

  it.each([
    ["Write three sentences about Istanbul.", "Istanbul is a historic city."],
    ["2026 yılında İstanbul hakkında bilgi ver", "Istanbul has a long history."],
    ["2 + ", "Please provide a complete expression."],
  ])("uses the provider for non-arithmetic task: %s", async (task, providerText) => {
    const execute = vi.fn(async () => "Calculator should not run.");
    const calculatorTool: Tool = { name: "calculator", description: "Evaluates arithmetic expressions.", execute };
    const generateResponse = vi.fn(async () => ({ type: "text" as const, text: providerText }));
    const agent = new SingleAgent({ generateResponse, continueAfterToolCall: unusedContinuation }, [calculatorTool]);

    await expect(agent.run(task)).resolves.toEqual({ type: "text", text: providerText });
    expect(execute).not.toHaveBeenCalled();
    expect(generateResponse).toHaveBeenCalledExactlyOnceWith(task, [calculatorTool]);
  });

  it("preserves the provider behavior when no tools are injected", async () => {
    const task = "Summarize the experiment.";
    const providerText = "The experiment completed successfully.";
    let receivedPrompt: string | undefined;
    const modelProvider: ModelProvider = {
      async generateResponse(prompt) {
        receivedPrompt = prompt;
        return { type: "text", text: providerText };
      },
      async continueAfterToolCall() {
        return { type: "text", text: providerText };
      },
    };

    await expect(new SingleAgent(modelProvider).run(task)).resolves.toEqual({ type: "text", text: providerText });
    expect(receivedPrompt).toBe(task);
  });

  it("keeps baseline prompt unchanged and adds only the locked structured instruction", async () => {
    const task = "Write a concise explanation.";
    const baselineGenerate = vi.fn(async () => ({ type: "text" as const, text: "baseline" }));
    const structuredGenerate = vi.fn(async () => ({ type: "text" as const, text: "structured" }));
    const provider = (generateResponse: typeof baselineGenerate): ModelProvider => ({
      generateResponse,
      continueAfterToolCall: unusedContinuation,
    });

    await new SingleAgent(provider(baselineGenerate)).run(task);
    await new SingleAgent(provider(structuredGenerate), [], "structured").run(task);

    expect(baselineGenerate).toHaveBeenCalledExactlyOnceWith(task, []);
    expect(structuredGenerate).toHaveBeenCalledExactlyOnceWith(`${task}\n\n${STRUCTURED_AGENT_INSTRUCTION}`, []);
  });

  it("executes a structured tool call and continues the model with its result", async () => {
    const task = "Calculate 12 * 8 and explain the result.";
    const calculator = new CalculatorTool();
    const execute = vi.fn((input: string) => calculator.execute(input));
    const calculatorTool: Tool = { ...calculator, execute };
    const provider = new FakeModelProvider([
      { type: "tool_call", callId: "call-1", toolName: "calculator", input: "12 * 8" },
      { type: "text", text: "The answer is 96." },
    ]);
    const generateResponse = vi.spyOn(provider, "generateResponse");
    const continueAfterToolCall = vi.spyOn(provider, "continueAfterToolCall");
    const agent = new SingleAgent(provider, [calculatorTool]);

    await expect(agent.run(task)).resolves.toEqual({ type: "text", text: "The answer is 96." });

    expect(execute).toHaveBeenCalledExactlyOnceWith("12 * 8");
    expect(generateResponse).toHaveBeenCalledOnce();
    expect(generateResponse.mock.calls[0][0]).toBe(task);
    expect(continueAfterToolCall).toHaveBeenCalledExactlyOnceWith("call-1", "96");
  });

  it("retries continuation without executing the tool again or exposing private values in events", async () => {
    const callId = "provider-private-call-id";
    const toolInput = "12 * 8";
    const toolResult = "96";
    const execute = vi.fn(async () => toolResult);
    const tool: Tool = { name: "calculator", description: "Calculates arithmetic.", execute };
    const continueAfterToolCall = vi.fn()
      .mockRejectedValueOnce(new RetryableProviderError())
      .mockResolvedValueOnce({ type: "text" as const, text: "The result is 96." });
    const provider = new RetryingModelProvider({
      async generateResponse() {
        return { type: "tool_call", callId, toolName: "calculator", input: toolInput };
      },
      continueAfterToolCall,
    }, {
      sleep: async () => {},
      random: () => 0,
    });
    const events: ToolLifecycleSignal[] = [];
    const agent = new SingleAgent(provider, [tool]);

    await expect(agent.run("Use the calculator and explain the result.", (event) => events.push(event))).resolves.toEqual({
      type: "text",
      text: "The result is 96.",
    });

    expect(execute).toHaveBeenCalledExactlyOnceWith(toolInput);
    expect(continueAfterToolCall).toHaveBeenCalledTimes(2);
    expect(continueAfterToolCall).toHaveBeenNthCalledWith(1, callId, toolResult);
    expect(continueAfterToolCall).toHaveBeenNthCalledWith(2, callId, toolResult);
    expect(events).toEqual([
      { type: "tool.started", toolName: "calculator" },
      { type: "tool.completed", toolName: "calculator" },
    ]);
    expect(JSON.stringify(events)).not.toContain(callId);
    expect(JSON.stringify(events)).not.toContain(toolInput);
    expect(JSON.stringify(events)).not.toContain(toolResult);
  });

  it("executes repeated valid tool calls within the budget", async () => {
    const calculator = new CalculatorTool();
    const execute = vi.fn((input: string) => calculator.execute(input));
    const calculatorTool: Tool = { ...calculator, execute };
    const provider = new FakeModelProvider([
      { type: "tool_call", callId: "call-1", toolName: "calculator", input: "12 * 8" },
      { type: "tool_call", callId: "call-2", toolName: "calculator", input: "96 + 1" },
      { type: "text", text: "The final result is 97." },
    ]);
    const continueAfterToolCall = vi.spyOn(provider, "continueAfterToolCall");
    const agent = new SingleAgent(provider, [calculatorTool]);

    await expect(agent.run("Calculate and increment.")).resolves.toEqual({
      type: "text",
      text: "The final result is 97.",
    });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(continueAfterToolCall).toHaveBeenNthCalledWith(1, "call-1", "96");
    expect(continueAfterToolCall).toHaveBeenNthCalledWith(2, "call-2", "97");
  });

  it("executes at most three tools and sends the third result before rejecting a fourth call", async () => {
    const execute = vi.fn(async (input: string) => `result-${input}`);
    const countedTool: Tool = { name: "counted", description: "Counts test calls.", execute };
    const provider = new FakeModelProvider(fourthToolRequestFixture);
    const continueAfterToolCall = vi.spyOn(provider, "continueAfterToolCall");
    const signals: ToolLifecycleSignal[] = [];
    const agent = new SingleAgent(provider, [countedTool]);

    await expect(agent.run("Use the counted tool repeatedly.", (signal) => signals.push(signal))).rejects.toThrow(
      "Tool execution limit reached.",
    );

    expect(execute).toHaveBeenCalledTimes(3);
    expect(continueAfterToolCall).toHaveBeenCalledTimes(3);
    expect(continueAfterToolCall).toHaveBeenLastCalledWith("call-3", "result-three");
    expect(signals.map((signal) => signal.type)).toEqual([
      "tool.started", "tool.completed",
      "tool.started", "tool.completed",
      "tool.started", "tool.completed",
    ]);
  });
});
