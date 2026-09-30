import OpenAI from "openai";
import type { ModelProvider, ModelResponse } from "../model-provider";

export class OpenAIModelProvider implements ModelProvider {
  private readonly client: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey?.trim()) {
      throw new Error("OPENAI_API_KEY is not configured.");
    }

    this.client = new OpenAI({ apiKey });
  }

  async generateResponse(prompt: string): Promise<ModelResponse> {
    try {
      const response = await this.client.responses.create({
        model: "gpt-6-luna",
        input: prompt,
      });

      return { type: "text", text: response.output_text };
    } catch {
      throw new Error("OpenAI text generation failed.");
    }
  }
}
