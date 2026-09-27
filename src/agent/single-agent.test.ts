import { describe, expect, it, vi } from "vitest";
import type { ModelProvider } from "./model-provider";
import { SingleAgent } from "./single-agent";
import { CalculatorTool } from "../tools/calculator-tool";
import type { Tool } from "../tools/tool";

describe("SingleAgent", () => {
  it("uses the injected calculator for arithmetic tasks", async () => {
    const generateText = vi.fn(async () => "Model provider should not run.");
    const agent = new SingleAgent({ generateText }, [new CalculatorTool()]);

    const result = await agent.run("12 * 8");

    expect(result).toBe("96");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("uses the provider for normal text tasks when a calculator is available", async () => {
    const task = "Write three sentences about Istanbul.";
    const providerResponse = "Istanbul is a historic city.";
    const execute = vi.fn(async () => "Calculator should not run.");
    const calculatorTool: Tool = {
      name: "calculator",
      description: "Evaluates arithmetic expressions.",
      execute,
    };
    const generateText = vi.fn(async () => providerResponse);
    const agent = new SingleAgent({ generateText }, [calculatorTool]);

    const result = await agent.run(task);

    expect(result).toBe(providerResponse);
    expect(execute).not.toHaveBeenCalled();
    expect(generateText).toHaveBeenCalledExactlyOnceWith(task);
  });

  it("keeps numeric natural-language tasks on the provider path", async () => {
    const task = "2026 yılında İstanbul hakkında bilgi ver";
    const providerResponse = "Istanbul has a long history.";
    const execute = vi.fn(async () => "Calculator should not run.");
    const calculatorTool: Tool = {
      name: "calculator",
      description: "Evaluates arithmetic expressions.",
      execute,
    };
    const generateText = vi.fn(async () => providerResponse);
    const agent = new SingleAgent({ generateText }, [calculatorTool]);

    const result = await agent.run(task);

    expect(result).toBe(providerResponse);
    expect(execute).not.toHaveBeenCalled();
    expect(generateText).toHaveBeenCalledExactlyOnceWith(task);
  });

  it("keeps malformed arithmetic-like input on the provider path", async () => {
    const task = "2 + ";
    const providerResponse = "Please provide a complete expression.";
    const execute = vi.fn(async () => "Calculator should not run.");
    const calculatorTool: Tool = {
      name: "calculator",
      description: "Evaluates arithmetic expressions.",
      execute,
    };
    const generateText = vi.fn(async () => providerResponse);
    const agent = new SingleAgent({ generateText }, [calculatorTool]);

    const result = await agent.run(task);

    expect(result).toBe(providerResponse);
    expect(execute).not.toHaveBeenCalled();
    expect(generateText).toHaveBeenCalledExactlyOnceWith(task);
  });

  it("preserves the provider behavior when no tools are injected", async () => {
    const task = "Summarize the experiment.";
    const providerResponse = "The experiment completed successfully.";
    let receivedPrompt: string | undefined;

    const modelProvider: ModelProvider = {
      async generateText(prompt) {
        receivedPrompt = prompt;
        return providerResponse;
      },
    };
    const agent = new SingleAgent(modelProvider);

    const result = await agent.run(task);

    expect(receivedPrompt).toBe(task);
    expect(result).toBe(providerResponse);
  });
});
