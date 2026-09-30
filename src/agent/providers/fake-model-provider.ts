import type { ModelProvider, ModelResponse } from "../model-provider";

export class FakeModelProvider implements ModelProvider {
  constructor(private readonly response?: ModelResponse) {}

  async generateResponse(prompt: string): Promise<ModelResponse> {
    return this.response ?? { type: "text", text: `[Fake Model] Task received: ${prompt}` };
  }
}
