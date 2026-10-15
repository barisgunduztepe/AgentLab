import type { ToolDefinition } from "../tools/tool";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type ToolCall = { callId: string; toolName: string; arguments: JsonObject };
export type ModelMessage =
  | { role: "system" | "user"; text: string }
  | { role: "assistant"; type: "text"; text: string }
  | { role: "assistant"; type: "tool_call"; call: ToolCall; text?: string }
  | { role: "tool"; callId: string; toolName: string; output: string };

export const FINISH_REASONS = ["stop", "tool_call", "length", "content_filter", "refusal", "unknown"] as const;
export type FinishReason = (typeof FINISH_REASONS)[number];
export type ModelUsage = { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } | null;
export type CompletionResponse = (
  | { type: "text"; text: string }
  | { type: "tool_call"; call: ToolCall; text?: string }
) & { finishReason: FinishReason; usage: ModelUsage };

export interface CompleteRequest {
  messages: readonly ModelMessage[];
  tools: readonly ToolDefinition[];
  signal?: AbortSignal;
}

export interface CompletionProvider {
  complete(request: CompleteRequest): Promise<CompletionResponse>;
}
