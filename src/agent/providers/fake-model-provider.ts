import type { ModelProvider, ModelResponse } from "../model-provider";

export class FakeModelProvider implements ModelProvider {
  private responseIndex = 0;

  constructor(private readonly responses: readonly ModelResponse[] = []) {}

  async generateResponse(prompt: string): Promise<ModelResponse> {
    return this.nextResponse(prompt);
  }

  async continueAfterToolCall(_callId: string, output: string): Promise<ModelResponse> {
    return this.nextResponse(output);
  }

  private nextResponse(prompt: string): ModelResponse {
    if (this.responseIndex < this.responses.length) {
      const response = this.responses[this.responseIndex];
      this.responseIndex += 1;
      return response;
    }

    if (this.responses.length > 0) {
      throw new Error("FakeModelProvider response sequence is exhausted.");
    }

    return { type: "text", text: `[Fake Model] Task received: ${prompt}` };
  }
}
