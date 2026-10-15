import OpenAI, { APIConnectionError, APIError, APIUserAbortError } from "openai";
import type { ModelProvider, ModelResponse, CompleteRequest } from "../model-provider";
import { AgentFailure } from "../agent-failure";
import { modelUsage, readToolCall, validateRequest } from "../model-contract";
import { RetryableProviderError } from "../retryable-provider-error";

export class OpenAIModelProvider implements ModelProvider {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(configuration?: { apiKey: string; model: string }, client?: OpenAI) {
    const apiKey = configuration?.apiKey ?? process.env.OPENAI_API_KEY;
    const model = configuration?.model ?? process.env.OPENAI_MODEL;
    if (!apiKey?.trim()) throw new Error("OPENAI_API_KEY is not configured.");
    if (!model?.trim()) throw new Error("OPENAI_MODEL is not configured.");
    this.model = model.trim();
    this.client = client ?? new OpenAI({ apiKey, maxRetries: 0 });
  }

  async complete(request: CompleteRequest): Promise<ModelResponse> {
    validateRequest(request);
    const input: OpenAI.Responses.ResponseInput = [];
    for (const message of request.messages) {
      if (message.role === "tool") {
        input.push({ type: "function_call_output", call_id: message.callId, output: message.output });
      } else if (message.role === "assistant" && message.type === "tool_call") {
        if (message.text !== undefined) input.push({ role: "assistant", content: message.text });
        input.push({ type: "function_call", call_id: message.call.callId, name: message.call.toolName,
          arguments: JSON.stringify(message.call.arguments) });
      } else input.push({ role: message.role, content: message.text });
    }
    let response: OpenAI.Responses.Response;
    try {
      response = await this.client.responses.create({
        model: this.model, input, store: false,
        tools: request.tools.map((tool) => ({ type: "function", name: tool.name, description: tool.description,
          strict: false, parameters: structuredClone(tool.parameters) as unknown as Record<string, unknown> })),
        parallel_tool_calls: false, tool_choice: "auto",
      }, { signal: request.signal });
    } catch (error) {
      if (isRetryableOpenAIError(error)) throw new RetryableProviderError();
      throw new Error("OpenAI request failed.");
    }
    const calls = response.output.filter((item) => item.type === "function_call");
    if (calls.length > 1) throw new AgentFailure("invalid_tool_call");
    const usage = modelUsage(response.usage?.input_tokens, response.usage?.output_tokens, response.usage?.total_tokens);
    const text = response.output_text ?? "";
    const refusal = response.output.some((item) => item.type === "message" && item.content.some((part) => part.type === "refusal"));
    if (response.status === "incomplete") {
      const reason = response.incomplete_details?.reason;
      if (calls.length) throw new Error("Incomplete tool response.");
      if (reason === "max_output_tokens" || reason === "content_filter") {
        return { type: "text", text, finishReason: reason === "max_output_tokens" ? "length" : "content_filter", usage };
      }
      throw new Error("OpenAI response was not completed.");
    }
    if (response.status !== "completed") throw new Error("OpenAI response was not completed.");
    if (calls[0]) {
      let args: unknown;
      try { args = JSON.parse(calls[0].arguments); } catch { throw new AgentFailure("invalid_tool_call"); }
      return { type: "tool_call", call: readToolCall(calls[0].call_id, calls[0].name, args),
        ...(text ? { text } : {}), finishReason: "tool_call", usage };
    }
    return { type: "text", text, finishReason: refusal ? "refusal" : "stop", usage };
  }
}

function isRetryableOpenAIError(error: unknown): boolean {
  if (error instanceof APIUserAbortError) {
    return false;
  }

  if (error instanceof APIConnectionError) {
    return true;
  }

  if (!(error instanceof APIError)) {
    return false;
  }

  if ([408, 500, 502, 503, 504].includes(error.status ?? -1)) {
    return true;
  }

  return error.status === 429 && error.code === "rate_limit_exceeded";
}
