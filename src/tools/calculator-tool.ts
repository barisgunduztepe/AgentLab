import type { Tool } from "./tool";

const MAX_NESTING_DEPTH = 32;

export class CalculatorTool implements Tool {
  name = "calculator";
  description =
    "Evaluates basic arithmetic expressions with +, -, *, /, and parentheses.";

  async execute(input: string): Promise<string> {
    if (typeof input !== "string" || input.trim().length === 0) {
      throw new Error("Invalid arithmetic expression.");
    }

    const parser = new ArithmeticExpressionParser(input);
    return String(parser.parse());
  }
}

class ArithmeticExpressionParser {
  private position = 0;
  private nestingDepth = 0;

  constructor(private readonly input: string) {}

  parse(): number {
    const result = this.parseExpression();
    this.skipWhitespace();

    if (this.position !== this.input.length) {
      throw new Error("Invalid arithmetic expression.");
    }

    return this.ensureFinite(result);
  }

  private parseExpression(): number {
    let result = this.parseTerm();

    while (true) {
      if (this.consume("+")) {
        result = this.ensureFinite(result + this.parseTerm());
      } else if (this.consume("-")) {
        result = this.ensureFinite(result - this.parseTerm());
      } else {
        return result;
      }
    }
  }

  private parseTerm(): number {
    let result = this.parseUnary();

    while (true) {
      if (this.consume("*")) {
        result = this.ensureFinite(result * this.parseUnary());
      } else if (this.consume("/")) {
        const divisor = this.parseUnary();

        if (divisor === 0) {
          throw new Error("Division by zero is not allowed.");
        }

        result = this.ensureFinite(result / divisor);
      } else {
        return result;
      }
    }
  }

  private parseUnary(): number {
    let sign = 1;

    while (true) {
      if (this.consume("+")) {
        continue;
      }

      if (this.consume("-")) {
        sign *= -1;
        continue;
      }

      return this.ensureFinite(sign * this.parsePrimary());
    }
  }

  private parsePrimary(): number {
    if (this.consume("(")) {
      this.nestingDepth += 1;

      if (this.nestingDepth > MAX_NESTING_DEPTH) {
        throw new Error("Invalid arithmetic expression.");
      }

      try {
        const result = this.parseExpression();

        if (!this.consume(")")) {
          throw new Error("Invalid arithmetic expression.");
        }

        return result;
      } finally {
        this.nestingDepth -= 1;
      }
    }

    return this.parseNumber();
  }

  private parseNumber(): number {
    this.skipWhitespace();
    const start = this.position;
    let hasDigit = false;

    while (this.isDigit(this.input[this.position])) {
      this.position += 1;
      hasDigit = true;
    }

    if (this.input[this.position] === ".") {
      this.position += 1;

      while (this.isDigit(this.input[this.position])) {
        this.position += 1;
        hasDigit = true;
      }
    }

    if (!hasDigit) {
      throw new Error("Invalid arithmetic expression.");
    }

    const value = Number(this.input.slice(start, this.position));
    return this.ensureFinite(value);
  }

  private consume(character: string): boolean {
    this.skipWhitespace();

    if (this.input[this.position] !== character) {
      return false;
    }

    this.position += 1;
    return true;
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.input[this.position] ?? "")) {
      this.position += 1;
    }
  }

  private isDigit(character: string | undefined): boolean {
    return character !== undefined && character >= "0" && character <= "9";
  }

  private ensureFinite(value: number): number {
    if (!Number.isFinite(value)) {
      throw new Error("Invalid arithmetic expression.");
    }

    return value;
  }
}
