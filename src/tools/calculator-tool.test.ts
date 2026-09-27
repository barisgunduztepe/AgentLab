import { describe, expect, it } from "vitest";
import { CalculatorTool } from "./calculator-tool";

describe("CalculatorTool", () => {
  const calculator = new CalculatorTool();

  it("evaluates arithmetic with the expected operator precedence", async () => {
    await expect(calculator.execute("2 + 3 * 4")).resolves.toBe("14");
  });

  it("evaluates another supported operation deterministically", async () => {
    await expect(calculator.execute("(18 - 6) / 3")).resolves.toBe("4");
  });

  it("rejects invalid input with a safe error", async () => {
    await expect(calculator.execute("2 + secret")).rejects.toThrow(
      "Invalid arithmetic expression.",
    );
  });

  it("rejects division by zero with a controlled error", async () => {
    await expect(calculator.execute("5 / 0")).rejects.toThrow(
      "Division by zero is not allowed.",
    );
  });
});
