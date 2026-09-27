import OpenAI from "openai";
import type { ModelProvider } from "../model-provider";

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

  async generateText(prompt: string): Promise<string> {
    try {
      const response = await this.client.responses.create({
        model: "openai/gpt-oss-20b",
        input: prompt,
      });

      return response.output_text;
    } catch {
      throw new Error("Groq text generation failed.");
    }
  }
}
