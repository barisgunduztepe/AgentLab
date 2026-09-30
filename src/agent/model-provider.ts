export type ModelResponse =
  | { type: "text"; text: string }
  | { type: "tool_call"; toolName: string; input: string };

export interface ModelProvider {
  generateResponse(prompt: string): Promise<ModelResponse>;
}
