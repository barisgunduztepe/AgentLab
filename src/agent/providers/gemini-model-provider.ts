import { GoogleGenAI, type Interactions } from "@google/genai";
import type { ModelProvider, ModelResponse, CompleteRequest } from "../model-provider";
import { AgentFailure } from "../agent-failure";
import { modelUsage, readToolCall, validateRequest } from "../model-contract";
import { RetryableProviderError } from "../retryable-provider-error";

export class GeminiModelProvider implements ModelProvider {
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor(configuration?: { apiKey: string; model: string }, client?: GoogleGenAI) {
    const apiKey = configuration?.apiKey ?? process.env.GEMINI_API_KEY;
    const model = configuration?.model ?? process.env.GEMINI_MODEL;
    if (!apiKey?.trim()) throw new Error("GEMINI_API_KEY is not configured.");
    if (!model?.trim()) throw new Error("GEMINI_MODEL is not configured.");
    this.model = model.trim();
    try { this.client = client ?? new GoogleGenAI({ apiKey: apiKey.trim() }); }
    catch { throw new Error("Gemini client could not be initialized."); }
  }

  async complete(request: CompleteRequest): Promise<ModelResponse> {
    validateRequest(request);
    const input: Interactions.Step[] = [];
    let system: string | undefined;
    for (const message of request.messages) {
      if (message.role === "system") system = message.text;
      else if (message.role === "tool") input.push({ type: "function_result", call_id: message.callId, name: message.toolName, result: message.output });
      else if (message.role === "assistant" && message.type === "tool_call") {
        if (message.text !== undefined) input.push({ type: "model_output", content: [{ type: "text", text: message.text }] });
        input.push({ type: "function_call", id: message.call.callId, name: message.call.toolName, arguments: structuredClone(message.call.arguments) });
      } else input.push({ type: message.role === "user" ? "user_input" : "model_output", content: [{ type: "text", text: message.text }] });
    }
    let interaction: Interactions.Interaction;
    try {
      interaction = await this.client.interactions.create({
        model: this.model, input, stream: false, store: false,
        ...(system === undefined ? {} : { system_instruction: system }),
        tools: request.tools.map((tool) => ({ type: "function" as const, name: tool.name, description: tool.description,
          parameters: structuredClone(tool.parameters) })),
      }, { maxRetries: 0, signal: request.signal }) as Interactions.Interaction;
    } catch (error) {
      if (isRetryableGeminiError(error)) throw new RetryableProviderError();
      throw new Error("Gemini request failed.");
    }
    const calls = interaction.steps?.filter((step) => step.type === "function_call") ?? [];
    if (calls.length > 1) throw new AgentFailure("invalid_tool_call");
    const usage = modelUsage(interaction.usage?.total_input_tokens, interaction.usage?.total_output_tokens, interaction.usage?.total_tokens);
    const text = interaction.output_text ?? "";
    if (calls[0]) {
      if (interaction.status !== "requires_action") throw new Error("Gemini tool call response status is invalid.");
      return { type: "tool_call", call: readToolCall(calls[0].id, calls[0].name, calls[0].arguments),
        ...(text ? { text } : {}), finishReason: "tool_call", usage };
    }
    if (interaction.status !== "completed") throw new Error("Gemini response was not completed.");
    return { type: "text", text, finishReason: "stop", usage };
  }
}

function isRetryableGeminiError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const details = error as {
    name?: unknown;
    status?: unknown;
    statusCode?: unknown;
    error?: unknown;
  };
  const name = typeof details.name === "string" ? details.name : "";

  if (["AbortError", "APIUserAbortError", "RequestAbortedError"].includes(name)) {
    return false;
  }

  const status = typeof details.status === "number" ? details.status : details.statusCode;
  if ([408, 500, 502, 503, 504].includes(typeof status === "number" ? status : -1)) {
    return true;
  }

  if (status === 429) {
    return hasExplicitRateLimitCode(details.error);
  }

  return ["APIConnectionError", "APIConnectionTimeoutError"].includes(name);
}

function hasExplicitRateLimitCode(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const details = error as { code?: unknown; reason?: unknown; details?: unknown };
  const rateLimitCodes = new Set(["RATE_LIMIT_EXCEEDED", "rate_limit_exceeded"]);
  if (rateLimitCodes.has(String(details.code)) || rateLimitCodes.has(String(details.reason))) {
    return true;
  }

  if (!Array.isArray(details.details)) {
    return false;
  }

  return details.details.slice(0, 10).some((detail: unknown) => {
    if (typeof detail !== "object" || detail === null) {
      return false;
    }

    const structuredDetail = detail as { code?: unknown; reason?: unknown };
    return rateLimitCodes.has(String(structuredDetail.code)) || rateLimitCodes.has(String(structuredDetail.reason));
  });
}
