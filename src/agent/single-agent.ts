import { throwIfCancelled } from "./cancellation";
import { AgentFailure } from "./agent-failure";
import type { ModelProvider, ModelResponse, ModelMessage, FinishReason, ModelUsage } from "./model-provider";
import type { Tool } from "../tools/tool";

const MAX_CALCULATOR_NESTING_DEPTH = 32;
const MAX_TOOL_EXECUTIONS = 3;
export const STRUCTURED_AGENT_INSTRUCTION = 'Organize your response into the labeled sections “Key points” and “Conclusion.” Keep it concise and complete the original task.';
export type AgentConfigurationId = "baseline" | "structured";

export type ToolLifecycleSignal =
  | { type: "tool.started"; toolName: string }
  | { type: "tool.completed"; toolName: string }
  | { type: "tool.failed"; toolName: string };

/**
 * One model call as seen from the agent. Carries only the call's purpose, how long it took, and what kind of
 * answer came back; prompts, answers, tool input/output, and provider error text are never included.
 */
export type ModelCallSignal =
  | { type: "model.requested"; purpose: "initial" | "after_tool" }
  | { type: "model.responded"; outcome: "text" | "tool_call" | "error"; durationMs: number; finishReason: FinishReason; usage: ModelUsage }
  /** The task was solved without asking the model (a plain arithmetic task goes straight to the calculator tool). */
  | { type: "model.skipped"; reason: "deterministic_arithmetic" };

import type { ExperimentOutput } from "../experiments/types";
import { copyModelUsage, readToolCall, validateRequest, validateResponse } from "./model-contract";

export class SingleAgent {
  constructor(
    private readonly modelProvider: ModelProvider,
    private readonly tools: readonly Tool[] = [],
    private readonly configurationId: AgentConfigurationId = "baseline",
  ) {}

  async run(
    task: string,
    onToolLifecycle?: (signal: ToolLifecycleSignal) => void,
    onModelCall?: (signal: ModelCallSignal) => void,
    options: { signal?: AbortSignal } = {},
  ): Promise<ExperimentOutput> {
    const { signal } = options;
    throwIfCancelled(signal);
    const calculator = this.tools.find((tool) => tool.definition.name === "calculator");
    if (calculator && isSimpleArithmeticExpression(task)) {
      onModelCall?.({ type: "model.skipped", reason: "deterministic_arithmetic" });
      const text = await executeTool(calculator, { expression: task }, onToolLifecycle, signal);
      throwIfCancelled(signal);
      return { type: "text", text };
    }
    const prompt = this.configurationId === "structured" ? `${task}\n\n${STRUCTURED_AGENT_INSTRUCTION}` : task;
    const messages: ModelMessage[] = [{ role: "user", text: prompt }];
    const definitions = this.tools.map((tool) => tool.definition);
    const callIds = new Set<string>();
    let executionCount = 0;
    while (true) {
      throwIfCancelled(signal);
      const request = { messages: structuredClone(messages), tools: structuredClone(definitions), ...(signal ? { signal } : {}) };
      validateRequest(request);
      const response = await callProvider(executionCount === 0 ? "initial" : "after_tool",
        () => this.modelProvider.complete(request), onModelCall, signal);
      throwIfCancelled(signal);
      if (response.type === "text") {
        if (!["stop", "unknown"].includes(response.finishReason)) throw new AgentFailure("provider_error");
        messages.push({ role: "assistant", type: "text", text: response.text });
        return { type: "text", text: response.text };
      }
      const call = readToolCall(response.call?.callId, response.call?.toolName, response.call?.arguments);
      if (callIds.has(call.callId)) throw new AgentFailure("invalid_tool_call");
      callIds.add(call.callId);
      messages.push({ role: "assistant", type: "tool_call", call,
        ...(response.text === undefined ? {} : { text: response.text }) });
      const tool = this.tools.find((tool) => tool.definition.name === call.toolName);
      if (!tool) throw new AgentFailure("tool_unavailable");
      if (executionCount >= MAX_TOOL_EXECUTIONS) throw new AgentFailure("tool_limit");
      executionCount += 1;
      const output = await executeTool(tool, call.arguments, onToolLifecycle, signal);
      messages.push({ role: "tool", callId: call.callId, toolName: call.toolName, output });
    }
  }
}

async function executeTool(tool: Tool, input: import("./model-provider").JsonObject,
  onLifecycle?: (signal: ToolLifecycleSignal) => void, signal?: AbortSignal): Promise<string> {
  throwIfCancelled(signal);
  if (!tool.validateInput(input)) throw new AgentFailure("invalid_tool_call");
  const toolName = tool.definition.name;
  onLifecycle?.({ type: "tool.started", toolName });
  let output: string;
  try {
    throwIfCancelled(signal);
    output = await tool.execute(input, signal ? { signal } : {});
    throwIfCancelled(signal);
    if (typeof output !== "string") throw new Error("Invalid tool result.");
  } catch (cause) {
    onLifecycle?.({ type: "tool.failed", toolName });
    throwIfCancelled(signal);
    throw new AgentFailure("tool_failed", { cause, ...(cause instanceof Error ? { message: cause.message } : {}) });
  }
  onLifecycle?.({ type: "tool.completed", toolName });
  return output;
}

async function callProvider(purpose: "initial" | "after_tool", operation: () => Promise<ModelResponse>,
  onModelCall?: (signal: ModelCallSignal) => void, signal?: AbortSignal): Promise<ModelResponse> {
  throwIfCancelled(signal);
  onModelCall?.({ type: "model.requested", purpose });
  const started = Date.now();
  let response: ModelResponse;
  try {
    throwIfCancelled(signal);
    response = await operation();
    throwIfCancelled(signal);
    validateResponse(response);
  } catch (cause) {
    onModelCall?.({ type: "model.responded", outcome: "error", durationMs: Date.now() - started, finishReason: "unknown", usage: null });
    throwIfCancelled(signal);
    if (cause instanceof AgentFailure && cause.failureCode === "invalid_tool_call") throw cause;
    throw new AgentFailure("provider_error", { cause });
  }
  onModelCall?.({ type: "model.responded", outcome: response.type, durationMs: Date.now() - started,
    finishReason: response.finishReason, usage: copyModelUsage(response.usage) });
  return response;
}

function isSimpleArithmeticExpression(task: string): boolean {
  const expression = task.trim();
  let position = 0;
  let nestingDepth = 0;
  let hasOperation = false;

  function parseExpression(): boolean {
    if (!parseTerm()) {
      return false;
    }

    while (true) {
      if (consume("+")) {
        hasOperation = true;
        if (!parseTerm()) return false;
      } else if (consume("-")) {
        hasOperation = true;
        if (!parseTerm()) return false;
      } else {
        return true;
      }
    }
  }

  function parseTerm(): boolean {
    if (!parseUnary()) {
      return false;
    }

    while (true) {
      if (consume("*")) {
        hasOperation = true;
        if (!parseUnary()) return false;
      } else if (consume("/")) {
        hasOperation = true;
        if (!parseUnary()) return false;
      } else {
        return true;
      }
    }
  }

  function parseUnary(): boolean {
    while (true) {
      if (consume("+") || consume("-")) {
        continue;
      }

      return parsePrimary();
    }
  }

  function parsePrimary(): boolean {
    if (consume("(")) {
      nestingDepth += 1;

      if (nestingDepth > MAX_CALCULATOR_NESTING_DEPTH) {
        return false;
      }

      const isParenthesizedExpression =
        parseExpression() && consume(")");
      nestingDepth -= 1;
      return isParenthesizedExpression;
    }

    return parseNumber();
  }

  function parseNumber(): boolean {
    skipWhitespace();
    let digitCount = 0;

    while (isDigit(expression[position])) {
      position += 1;
      digitCount += 1;
    }

    if (expression[position] === ".") {
      position += 1;

      while (isDigit(expression[position])) {
        position += 1;
        digitCount += 1;
      }
    }

    return digitCount > 0;
  }

  function consume(character: string): boolean {
    skipWhitespace();

    if (expression[position] !== character) {
      return false;
    }

    position += 1;
    return true;
  }

  function skipWhitespace(): void {
    while (/\s/.test(expression[position] ?? "")) {
      position += 1;
    }
  }

  function isDigit(character: string | undefined): boolean {
    return character !== undefined && character >= "0" && character <= "9";
  }

  const isValidExpression = parseExpression();
  skipWhitespace();

  return isValidExpression && position === expression.length && hasOperation;
}
