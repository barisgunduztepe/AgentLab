import type { ModelProvider, ModelResponse, CompleteRequest } from "../model-provider";
import { validateRequest, validateResponse } from "../model-contract";

/** Scripted responses may omit metrics; fake has no measured token usage by default. */
export type FakeResponse = (
  | { type: "text"; text: string }
  | { type: "tool_call"; call: import("../model-provider").ToolCall; text?: string }
) & Partial<Pick<ModelResponse, "finishReason" | "usage">>;

export class FakeModelProvider implements ModelProvider {
  private readonly responses: readonly ModelResponse[];
  constructor(responses: readonly FakeResponse[] = []) {
    this.responses = structuredClone(responses).map((response) => ({
      ...response, finishReason: response.finishReason ?? (response.type === "text" ? "stop" : "tool_call"), usage: response.usage ?? null,
    }));
  }

  async complete(request: CompleteRequest): Promise<ModelResponse> {
    validateRequest(request);
    let index = 0;
    for (const message of request.messages) {
      if (message.role !== "assistant") continue;
      const expected = this.responses[index];
      if (message.type !== "tool_call" || expected?.type !== "tool_call" ||
          message.call.callId !== expected.call.callId || message.call.toolName !== expected.call.toolName ||
          JSON.stringify(message.call.arguments) !== JSON.stringify(expected.call.arguments) || message.text !== expected.text) {
        throw new Error("Fake conversation does not match its script.");
      }
      index += 1;
    }
    const response = this.responses.length ? this.responses[index] : {
      type: "text" as const,
      text: `[Fake Model] Task received: ${request.messages.flatMap((message) => message.role === "user" ? [message.text] : []).at(-1) ?? ""}`,
      finishReason: "stop" as const, usage: null,
    };
    if (!response) throw new Error("FakeModelProvider response sequence is exhausted.");
    validateResponse(response);
    return structuredClone(response);
  }
}
