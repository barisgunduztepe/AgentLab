import { AgentFailure } from "./agent-failure";
import type { ModelProvider, ModelResponse } from "./model-provider";
import type { Tool } from "../tools/tool";

const MAX_CALCULATOR_NESTING_DEPTH = 32;
const MAX_TOOL_EXECUTIONS = 3;
export const STRUCTURED_AGENT_INSTRUCTION = 'Organize your response into the labeled sections “Key points” and “Conclusion.” Keep it concise and complete the original task.';
export type AgentConfigurationId = "baseline" | "structured";

export type ToolLifecycleSignal =
  | { type: "tool.started"; toolName: string }
  | { type: "tool.completed"; toolName: string }
  | { type: "tool.failed"; toolName: string };

export class SingleAgent {
  constructor(
    private readonly modelProvider: ModelProvider,
    private readonly tools: readonly Tool[] = [],
    private readonly configurationId: AgentConfigurationId = "baseline",
  ) {}

  async run(
    task: string,
    onToolLifecycle?: (signal: ToolLifecycleSignal) => void,
  ): Promise<Extract<ModelResponse, { type: "text" }>> {
    const calculatorTool = this.tools.find((tool) => tool.name === "calculator");

    if (calculatorTool && isSimpleArithmeticExpression(task)) {
      onToolLifecycle?.({ type: "tool.started", toolName: calculatorTool.name });

      let output: string;
      try {
        output = await calculatorTool.execute(task);
      } catch (error) {
        onToolLifecycle?.({ type: "tool.failed", toolName: calculatorTool.name });
        throw toToolFailure(error);
      }

      onToolLifecycle?.({ type: "tool.completed", toolName: calculatorTool.name });
      return { type: "text", text: output };
    }

    const prompt = this.configurationId === "structured"
      ? `${task}\n\n${STRUCTURED_AGENT_INSTRUCTION}`
      : task;
    let response = await callProvider(() => this.modelProvider.generateResponse(prompt, this.tools));
    let executionCount = 0;

    while (response.type === "tool_call") {
      if (
        typeof response.callId !== "string" ||
        response.callId.trim().length === 0 ||
        typeof response.toolName !== "string" ||
        response.toolName.trim().length === 0 ||
        typeof response.input !== "string"
      ) {
        throw new AgentFailure("invalid_tool_call");
      }

      const toolName = response.toolName;
      const toolInput = response.input;
      const tool = this.tools.find((allowedTool) => allowedTool.name === toolName);

      if (!tool) {
        throw new AgentFailure("tool_unavailable");
      }

      if (executionCount >= MAX_TOOL_EXECUTIONS) {
        throw new AgentFailure("tool_limit");
      }

      onToolLifecycle?.({ type: "tool.started", toolName: tool.name });
      executionCount += 1;

      let toolResult: string;
      try {
        toolResult = await tool.execute(toolInput);
      } catch (error) {
        onToolLifecycle?.({ type: "tool.failed", toolName: tool.name });
        throw toToolFailure(error);
      }

      onToolLifecycle?.({ type: "tool.completed", toolName: tool.name });
      const callId = response.callId;
      response = await callProvider(() => this.modelProvider.continueAfterToolCall(callId, toolResult));
    }

    return response;
  }
}

/** Keeps the tool's own message for internal diagnostics while giving the run a safe failure code. */
function toToolFailure(error: unknown): AgentFailure {
  return new AgentFailure("tool_failed", {
    ...(error instanceof Error ? { message: error.message } : {}),
    cause: error,
  });
}

async function callProvider(operation: () => Promise<ModelResponse>): Promise<ModelResponse> {
  try {
    return await operation();
  } catch (error) {
    throw new AgentFailure("provider_error", { cause: error });
  }
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
