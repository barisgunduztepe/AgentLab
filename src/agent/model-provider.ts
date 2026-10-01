import type { Tool } from "../tools/tool";

export type ModelResponse =
  | { type: "text"; text: string }
  | { type: "tool_call"; callId: string; toolName: string; input: string };

export type ModelTool = Pick<Tool, "name" | "description">;

export interface ModelProvider {
  generateResponse(prompt: string, tools?: readonly ModelTool[]): Promise<ModelResponse>;
  continueAfterToolCall(callId: string, output: string): Promise<ModelResponse>;
}
