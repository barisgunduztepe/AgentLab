import type { ModelProvider } from "../model-provider";

export class FakeModelProvider implements ModelProvider {
  async generateText(prompt: string): Promise<string> {
    return `[Fake Model] Task received: ${prompt}`;
  }
}
