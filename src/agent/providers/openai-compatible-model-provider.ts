import OpenAI, { APIConnectionError, APIError, APIUserAbortError } from "openai";
import { AgentFailure } from "../agent-failure";
import { throwIfCancelled } from "../cancellation";
import { modelUsage, readToolCall, validateRequest, validateResponse } from "../model-contract";
import type { CompleteRequest, FinishReason, ModelProvider, ModelResponse } from "../model-provider";
import { RetryableProviderError } from "../retryable-provider-error";

export interface OpenAICompatibleConfiguration {
  baseURL: string;
  model: string;
  apiKey?: string;
}

function normalizeConfiguration(config: OpenAICompatibleConfiguration): OpenAICompatibleConfiguration {
  if (!config.baseURL?.trim()) throw new Error("OPENAI_COMPATIBLE_BASE_URL is not configured.");
  if (!config.model?.trim()) throw new Error("OPENAI_COMPATIBLE_MODEL is not configured.");
  let url: URL;
  try { url = new URL(config.baseURL.trim()); } catch { throw new Error("OPENAI_COMPATIBLE_BASE_URL is invalid."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("OPENAI_COMPATIBLE_BASE_URL is invalid.");
  }
  return { baseURL: url.href.replace(/\/+$/, ""), model: config.model.trim(),
    ...(config.apiKey?.trim() ? { apiKey: config.apiKey.trim() } : {}) };
}

export function getOpenAICompatibleConfiguration(env: Readonly<Record<string, string | undefined>> = process.env): OpenAICompatibleConfiguration {
  return normalizeConfiguration({ baseURL: env.OPENAI_COMPATIBLE_BASE_URL ?? "", model: env.OPENAI_COMPATIBLE_MODEL ?? "",
    apiKey: env.OPENAI_COMPATIBLE_API_KEY });
}

/** Chat Completions transport, separate from the OpenAI Responses adapter. */
export class OpenAICompatibleModelProvider implements ModelProvider {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(configuration?: OpenAICompatibleConfiguration, client?: OpenAI) {
    const config = normalizeConfiguration(configuration ?? getOpenAICompatibleConfiguration());
    this.model = config.model;
    this.client = client ?? new OpenAI({
      baseURL: config.baseURL, apiKey: config.apiKey ?? "agentlab-local-no-key", maxRetries: 0,
      adminAPIKey: null, organization: null, project: null,
      // The SDK needs a constructor credential; a keyless local server receives no auth header.
      ...(!config.apiKey ? { defaultHeaders: { Authorization: null } } : {}),
    });
  }

  async complete(request: CompleteRequest): Promise<ModelResponse> {
    throwIfCancelled(request.signal);
    validateRequest(request);
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = request.messages.map((message) => {
      if (message.role === "tool") return { role: "tool", tool_call_id: message.callId, content: message.output };
      if (message.role === "assistant" && message.type === "tool_call") return {
        role: "assistant", content: message.text ?? null,
        tool_calls: [{ type: "function", id: message.call.callId, function: {
          name: message.call.toolName, arguments: JSON.stringify(message.call.arguments),
        } }],
      };
      return { role: message.role, content: message.text };
    });
    let completion: OpenAI.Chat.Completions.ChatCompletion;
    try {
      completion = await this.client.chat.completions.create({
        model: this.model, messages, stream: false,
        ...(request.tools.length ? {
          tools: request.tools.map((tool) => ({ type: "function" as const, function: {
            name: tool.name, description: tool.description,
            parameters: structuredClone(tool.parameters) as unknown as Record<string, unknown>,
          } })), tool_choice: "auto" as const,
        } : {}),
        // Do not require parallel_tool_calls support from a compatible server.
        // Multiple returned calls are rejected before any tool can run.
      }, { signal: request.signal });
    } catch (error) {
      throwIfCancelled(request.signal);
      if (isRetryable(error)) throw new RetryableProviderError();
      throw new Error("OpenAI-compatible request failed.");
    }
    throwIfCancelled(request.signal);
    if (completion.choices?.length !== 1) throw new Error("Invalid completion choices.");
    const choice = completion.choices[0];
    const message = choice.message;
    if (!message || message.role !== "assistant") throw new Error("Invalid completion message.");
    const calls = message.tool_calls ?? [];
    if (!Array.isArray(calls) || calls.length > 1 || message.function_call) throw new AgentFailure("invalid_tool_call");
    const usage = modelUsage(completion.usage?.prompt_tokens, completion.usage?.completion_tokens, completion.usage?.total_tokens);
    const text = message.content;
    if (text !== null && text !== undefined && typeof text !== "string") throw new Error("Invalid completion text.");
    let response: ModelResponse;
    if (calls[0]) {
      const call = calls[0];
      if (choice.finish_reason !== "tool_calls" || call.type !== "function") throw new AgentFailure("invalid_tool_call");
      let args: unknown;
      try { args = JSON.parse(call.function.arguments); } catch { throw new AgentFailure("invalid_tool_call"); }
      response = { type: "tool_call", call: readToolCall(call.id, call.function.name, args),
        ...(text === null || text === undefined ? {} : { text }), finishReason: "tool_call", usage };
    } else {
      if (choice.finish_reason === "tool_calls" || choice.finish_reason === "function_call") throw new AgentFailure("invalid_tool_call");
      const nativeReason: string = choice.finish_reason;
      const finishReason: FinishReason = message.refusal ? "refusal" :
        ["stop", "length", "content_filter"].includes(nativeReason) ? nativeReason as FinishReason : "unknown";
      if (typeof text !== "string" && finishReason !== "refusal" && finishReason !== "content_filter") throw new Error("Missing completion text.");
      response = { type: "text", text: text ?? "", finishReason, usage };
    }
    validateResponse(response);
    return response;
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof APIUserAbortError) return false;
  if (error instanceof APIConnectionError) return true;
  if (!(error instanceof APIError)) return false;
  return [408, 500, 502, 503, 504].includes(error.status ?? -1) ||
    (error.status === 429 && error.code === "rate_limit_exceeded");
}
