import { AgentFailure } from "./agent-failure";
import { FINISH_REASONS, type CompleteRequest, type CompletionResponse, type JsonObject, type JsonValue, type ModelUsage, type ToolCall } from "./model-completion";
import type { ToolDefinition } from "../tools/tool";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isJson(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  return isRecord(value) && Object.values(value).every(isJson);
}

export function readToolCall(callId: unknown, toolName: unknown, args: unknown): ToolCall {
  if (typeof callId !== "string" || !callId.trim() || typeof toolName !== "string" || !toolName.trim() ||
      !isRecord(args) || !isJson(args)) throw new AgentFailure("invalid_tool_call");
  return { callId, toolName, arguments: args as JsonObject };
}

export function validateToolDefinition(tool: ToolDefinition): void {
  const schema = tool.parameters;
  if (!tool.name.trim() || typeof tool.description !== "string" || !isRecord(schema) ||
      Object.keys(schema).some((key) => !["type", "properties", "required", "additionalProperties"].includes(key)) ||
      schema.type !== "object" || schema.additionalProperties !== false || !isRecord(schema.properties) ||
      !Array.isArray(schema.required) || new Set(schema.required).size !== schema.required.length ||
      schema.required.some((key) => typeof key !== "string" || !Object.hasOwn(schema.properties, key))) {
    throw new Error("Unsupported tool schema.");
  }
  for (const field of Object.values(schema.properties)) {
    if (!isRecord(field) || Object.keys(field).some((key) => !["type", "description", "enum"].includes(key)) ||
        !["string", "number", "integer", "boolean"].includes(String(field.type)) ||
        (field.description !== undefined && typeof field.description !== "string") ||
        (field.enum !== undefined && (!Array.isArray(field.enum) || !field.enum.length || field.enum.some((v: unknown) =>
          field.type === "integer" ? !Number.isSafeInteger(v) :
            typeof v !== field.type || (typeof v === "number" && !Number.isFinite(v)))))) {
      throw new Error("Unsupported tool schema.");
    }
  }
}

export function validateRequest(request: CompleteRequest): void {
  if (!request.messages.length) throw new Error("A conversation is required.");
  const names = new Set<string>();
  for (const tool of request.tools) {
    validateToolDefinition(tool);
    if (names.has(tool.name)) throw new Error("Duplicate tool definition.");
    names.add(tool.name);
  }
  const seen = new Set<string>();
  let pending: ToolCall | undefined;
  for (const [index, message] of request.messages.entries()) {
    if (pending && message.role !== "tool") throw new AgentFailure("invalid_tool_call");
    if (message.role === "system" || message.role === "user") {
      if (typeof message.text !== "string" || (message.role === "system" && index !== 0)) throw new Error("Invalid message.");
    } else if (message.role === "assistant" && message.type === "text") {
      if (typeof message.text !== "string") throw new Error("Invalid message.");
    } else if (message.role === "assistant" && message.type === "tool_call") {
      pending = readToolCall(message.call?.callId, message.call?.toolName, message.call?.arguments);
      if (seen.has(pending.callId)) throw new AgentFailure("invalid_tool_call");
      seen.add(pending.callId);
      if (message.text !== undefined && typeof message.text !== "string") throw new Error("Invalid message.");
    } else if (message.role === "tool") {
      if (!pending || pending.callId !== message.callId || pending.toolName !== message.toolName || typeof message.output !== "string") {
        throw new AgentFailure("invalid_tool_call");
      }
      pending = undefined;
    } else throw new Error("Invalid message.");
  }
  if (pending) throw new AgentFailure("invalid_tool_call");
}

export function tokenCount(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid model usage.");
  return value;
}

export function modelUsage(input: unknown, output: unknown, total: unknown): ModelUsage {
  const usage = { inputTokens: tokenCount(input), outputTokens: tokenCount(output), totalTokens: tokenCount(total) };
  return Object.values(usage).every((value) => value === null) ? null : usage;
}

export function isModelUsage(value: unknown, strictKeys = true): value is ModelUsage {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  const keys = ["inputTokens", "outputTokens", "totalTokens"];
  return (!strictKeys || Object.keys(value).length === 3) && keys.every((key) =>
    value[key] === null || (typeof value[key] === "number" && Number.isSafeInteger(value[key]) && value[key] >= 0));
}

export function copyModelUsage(usage: ModelUsage): ModelUsage {
  return usage === null ? null : { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens };
}

export function validateResponse(response: CompletionResponse): void {
  if (!FINISH_REASONS.includes(response.finishReason)) throw new Error("Invalid finish reason.");
  if (!isModelUsage(response.usage, false)) throw new Error("Invalid model usage.");
  if (response.type === "tool_call") {
    readToolCall(response.call?.callId, response.call?.toolName, response.call?.arguments);
    if (response.finishReason !== "tool_call") throw new Error("Inconsistent model response.");
    if (response.text !== undefined && typeof response.text !== "string") throw new Error("Invalid model text.");
  } else if (response.type !== "text" || typeof response.text !== "string" || response.finishReason === "tool_call") {
    throw new Error("Invalid model response.");
  }
}
