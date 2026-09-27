import type { ModelProvider } from "./model-provider";

export class SingleAgent {
  constructor(private readonly modelProvider: ModelProvider) {}

  run(task: string): Promise<string> {
    return this.modelProvider.generateText(task);
  }
}
