/**
 * Safe, stable reasons an agent run can fail. Codes describe the category only; they never carry
 * prompts, tool input/output, or provider error text.
 */
export const FAILURE_CODES = [
  "tool_unavailable",
  "tool_limit",
  "invalid_tool_call",
  "tool_failed",
  "provider_error",
  "invalid_handoff",
  "unknown",
] as const;

export type FailureCode = (typeof FAILURE_CODES)[number];

const DEFAULT_MESSAGES: Record<FailureCode, string> = {
  tool_unavailable: "Requested tool is unavailable.",
  tool_limit: "Tool execution limit reached.",
  invalid_tool_call: "Tool call is invalid.",
  tool_failed: "Tool execution failed.",
  provider_error: "Model provider request failed.",
  invalid_handoff: "Agent handoff could not be completed.",
  unknown: "Agent run failed.",
};

/** An agent failure with a machine-readable category. The message stays internal and is never shown to users. */
export class AgentFailure extends Error {
  readonly failureCode: FailureCode;

  constructor(failureCode: FailureCode, options: { message?: string; cause?: unknown } = {}) {
    super(options.message ?? DEFAULT_MESSAGES[failureCode], { cause: options.cause });
    this.name = "AgentFailure";
    this.failureCode = failureCode;
  }
}

export function isFailureCode(value: unknown): value is FailureCode {
  return typeof value === "string" && (FAILURE_CODES as readonly string[]).includes(value);
}

/** Category of any thrown value; anything that is not an AgentFailure is `unknown`. */
export function failureCodeOf(error: unknown): FailureCode {
  return error instanceof AgentFailure ? error.failureCode : "unknown";
}
