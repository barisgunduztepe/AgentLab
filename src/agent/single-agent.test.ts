import { describe, expect, it, vi } from "vitest";
import type { ModelProvider } from "./model-provider";
import { SingleAgent, type ToolLifecycleSignal } from "./single-agent";
import { CalculatorTool } from "../tools/calculator-tool";
import type { Tool } from "../tools/tool";

describe("SingleAgent", () => {
  it("uses the injected calculator for arithmetic tasks", async () => {
    const generateResponse = vi.fn(async () => ({ type: "text" as const, text: "unused" }));
    const agent = new SingleAgent({ generateResponse }, [new CalculatorTool()]);

    await expect(agent.run("12 * 8")).resolves.toEqual({ type: "text", text: "96" });
    expect(generateResponse).not.toHaveBeenCalled();
  });

  it("emits tool lifecycle signals around a successful calculator call", async () => {
    const signals: ToolLifecycleSignal[] = [];
    const agent = new SingleAgent({ generateResponse: async () => ({ type: "text", text: "unused" }) }, [new CalculatorTool()]);

    await expect(agent.run("12 * 8", (signal) => signals.push(signal))).resolves.toEqual({ type: "text", text: "96" });
    expect(signals).toEqual([
      { type: "tool.started", toolName: "calculator" },
      { type: "tool.completed", toolName: "calculator" },
    ]);
  });

  it("emits a failed tool lifecycle signal and rethrows tool errors", async () => {
    const signals: ToolLifecycleSignal[] = [];
    const rawToolError = "Division by zero is not allowed.";
    const agent = new SingleAgent({ generateResponse: async () => ({ type: "text", text: "unused" }) }, [new CalculatorTool()]);

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
    const agent = new SingleAgent({ generateResponse }, [calculatorTool]);

    await expect(agent.run(task)).resolves.toEqual({ type: "text", text: providerText });
    expect(execute).not.toHaveBeenCalled();
    expect(generateResponse).toHaveBeenCalledExactlyOnceWith(task);
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
    };

    await expect(new SingleAgent(modelProvider).run(task)).resolves.toEqual({ type: "text", text: providerText });
    expect(receivedPrompt).toBe(task);
  });

  it("returns structured tool calls without executing them", async () => {
    const response = { type: "tool_call" as const, toolName: "calculator", input: "12 * 8" };
    const execute = vi.fn(async () => "should not execute");
    const calculatorTool: Tool = { name: "calculator", description: "Calculates.", execute };
    const generateResponse = vi.fn(async () => response);

    await expect(new SingleAgent({ generateResponse }, [calculatorTool]).run("Calculate 12 * 8")).resolves.toEqual(response);
    expect(execute).not.toHaveBeenCalled();
  });
});
