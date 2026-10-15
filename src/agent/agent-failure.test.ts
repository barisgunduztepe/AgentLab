import { describe, expect, it } from "vitest";
import { AgentFailure, FAILURE_CODES, failureCodeOf, isFailureCode } from "./agent-failure";

describe("AgentFailure", () => {
  it("carries a failure code, a default internal message, and an optional cause", () => {
    const cause = new Error("private provider detail");
    const failure = new AgentFailure("provider_error", { cause });

    expect(failure).toBeInstanceOf(Error);
    expect(failure.failureCode).toBe("provider_error");
    expect(failure.message).toBe("Model provider request failed.");
    expect(failure.cause).toBe(cause);
  });

  it("allows a custom message without changing the code", () => {
    const failure = new AgentFailure("tool_failed", { message: "Division by zero is not allowed." });

    expect(failure.failureCode).toBe("tool_failed");
    expect(failure.message).toBe("Division by zero is not allowed.");
  });

  it("classifies only AgentFailure values and falls back to unknown", () => {
    expect(failureCodeOf(new AgentFailure("tool_limit"))).toBe("tool_limit");
    expect(failureCodeOf(new Error("plain"))).toBe("unknown");
    expect(failureCodeOf("not an error")).toBe("unknown");
    expect(failureCodeOf(undefined)).toBe("unknown");
  });

  it("recognizes exactly the declared failure codes", () => {
    for (const code of FAILURE_CODES) expect(isFailureCode(code)).toBe(true);
    expect(isFailureCode("agent_execution_failed")).toBe(false);
    expect(isFailureCode(undefined)).toBe(false);
  });
});
