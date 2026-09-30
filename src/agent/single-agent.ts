import type { ModelProvider, ModelResponse } from "./model-provider";
import type { Tool } from "../tools/tool";

const MAX_CALCULATOR_NESTING_DEPTH = 32;

export type ToolLifecycleSignal =
  | { type: "tool.started"; toolName: string }
  | { type: "tool.completed"; toolName: string }
  | { type: "tool.failed"; toolName: string };

export class SingleAgent {
  constructor(
    private readonly modelProvider: ModelProvider,
    private readonly tools: readonly Tool[] = [],
  ) {}

  async run(
    task: string,
    onToolLifecycle?: (signal: ToolLifecycleSignal) => void,
  ): Promise<ModelResponse> {
    const calculatorTool = this.tools.find((tool) => tool.name === "calculator");

    if (calculatorTool && isSimpleArithmeticExpression(task)) {
      onToolLifecycle?.({ type: "tool.started", toolName: calculatorTool.name });

      let output: string;
      try {
        output = await calculatorTool.execute(task);
      } catch (error) {
        onToolLifecycle?.({ type: "tool.failed", toolName: calculatorTool.name });
        throw error;
      }

      onToolLifecycle?.({ type: "tool.completed", toolName: calculatorTool.name });
      return { type: "text", text: output };
    }

    return this.modelProvider.generateResponse(task);
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
