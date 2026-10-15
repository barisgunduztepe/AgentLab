import { describe, expect, it } from "vitest";
import { CalculatorTool } from "../tools/calculator-tool";
import { modelUsage, validateRequest, validateToolDefinition } from "./model-contract";
import type { ModelMessage } from "./model-completion";

describe("completion contract", () => {
  const call = { callId: "one", toolName: "calculator", arguments: { expression: "1+1" } };
  const messages: ModelMessage[] = [
    { role: "user", text: "Calculate and explain" },
    { role: "assistant", type: "tool_call", call },
    { role: "tool", callId: "one", toolName: "calculator", output: "2" },
  ];
  it("validates complete turns and rejects unmatched, pending and duplicate calls", () => {
    expect(() => validateRequest({ messages, tools: [new CalculatorTool().definition] })).not.toThrow();
    for (const invalid of [messages.slice(0, 2), [...messages, ...messages.slice(1)], [messages[2]]]) {
      expect(() => validateRequest({ messages: invalid, tools: [] })).toThrow();
    }
  });
  it("rejects misplaced system messages and unsupported schema keywords", () => {
    expect(() => validateRequest({ messages: [...messages, { role: "system", text: "late" }], tools: [] })).toThrow();
    const tool = new CalculatorTool().definition;
    expect(() => validateToolDefinition({ ...tool, parameters: { ...tool.parameters, $ref: "hidden" } } as unknown as typeof tool)).toThrow();
  });
  it("keeps partial and zero usage without inventing totals", () => {
    expect(modelUsage(undefined, undefined, undefined)).toBeNull();
    expect(modelUsage(0, 2, undefined)).toEqual({ inputTokens: 0, outputTokens: 2, totalTokens: null });
    expect(() => modelUsage(-1, 2, 1)).toThrow();
    expect(() => modelUsage(1.5, 2, 4)).toThrow();
  });
});
