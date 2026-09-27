export interface ModelProvider {
  generateText(prompt: string): Promise<string>;
}
