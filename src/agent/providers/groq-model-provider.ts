import OpenAI from "openai";
import type { ModelProvider, ModelResponse } from "../model-provider";

export class GroqModelProvider implements ModelProvider {
  private readonly client: OpenAI;

  constructor() {
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey?.trim()) {
      throw new Error("GROQ_API_KEY is not configured.");
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });
  }

  async generateResponse(prompt: string): Promise<ModelResponse> {
    try {
      const response = await this.client.responses.create({
        model: "openai/gpt-oss-20b",
        input: prompt,
      });

      return { type: "text", text: response.output_text };
    } catch {
      throw new Error("Groq text generation failed.");
    }
  }
}
