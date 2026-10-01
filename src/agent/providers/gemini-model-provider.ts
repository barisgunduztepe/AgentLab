import { GoogleGenAI, type Interactions } from "@google/genai";
import type { ModelProvider, ModelResponse, ModelTool } from "../model-provider";

export class GeminiModelProvider implements ModelProvider {
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private previousInteractionId: string | undefined;
  private pendingCallId: string | undefined;
  private pendingFunctionName: string | undefined;
  private tools: readonly ModelTool[] = [];

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL;

    if (!apiKey?.trim()) {
      throw new Error("GEMINI_API_KEY is not configured.");
    }

    if (!model?.trim()) {
      throw new Error("GEMINI_MODEL is not configured.");
    }

    this.model = model.trim();
    try {
      this.client = new GoogleGenAI({ apiKey: apiKey.trim() });
    } catch {
      throw new Error("Gemini client could not be initialized.");
    }
  }

  async generateResponse(prompt: string, tools: readonly ModelTool[] = []): Promise<ModelResponse> {
    this.tools = tools;
    this.previousInteractionId = undefined;
    this.pendingCallId = undefined;
    this.pendingFunctionName = undefined;

    const interaction = await this.createInteraction({
      model: this.model,
      input: prompt,
      tools: getCalculatorFunctionTools(tools),
    });

    return this.readInteraction(interaction);
  }

  async continueAfterToolCall(callId: string, output: string): Promise<ModelResponse> {
    if (
      !this.pendingCallId ||
      callId !== this.pendingCallId ||
      !this.pendingFunctionName ||
      !this.previousInteractionId
    ) {
      throw new Error("Tool call continuation is invalid.");
    }

    const previousInteractionId = this.previousInteractionId;
    const functionName = this.pendingFunctionName;
    this.pendingCallId = undefined;
    this.pendingFunctionName = undefined;

    const interaction = await this.createInteraction({
      model: this.model,
      previous_interaction_id: previousInteractionId,
      input: [{
        type: "function_result",
        name: functionName,
        call_id: callId,
        result: output,
      }],
      tools: getCalculatorFunctionTools(this.tools),
    });

    return this.readInteraction(interaction);
  }

  private async createInteraction(
    params: Interactions.CreateModelInteractionParamsNonStreaming,
  ): Promise<Interactions.Interaction> {
    try {
      return await this.client.interactions.create({ ...params, stream: false }) as Interactions.Interaction;
    } catch {
      throw new Error("Gemini request failed.");
    }
  }

  private readInteraction(
    interaction: Interactions.Interaction,
  ): ModelResponse {
    return this.mapInteraction(interaction);
  }

  private mapInteraction(
    interaction: Interactions.Interaction,
  ): ModelResponse {
    const functionCalls = interaction.steps?.filter((step) => step.type === "function_call") ?? [];

    if (functionCalls.length > 1) {
      throw new Error("Multiple tool calls are not supported.");
    }

    const functionCall = functionCalls[0];
    if (!functionCall) {
      if (interaction.status !== "completed") {
        throw new Error("Gemini response was not completed.");
      }

      this.pendingCallId = undefined;
      this.pendingFunctionName = undefined;
      return { type: "text", text: interaction.output_text ?? "" };
    }

    if (interaction.status !== "requires_action") {
      throw new Error("Gemini tool call response status is invalid.");
    }

    if (
      typeof functionCall.id !== "string" ||
      functionCall.id.trim().length === 0 ||
      typeof functionCall.name !== "string" ||
      functionCall.name.trim().length === 0
    ) {
      throw new Error("Gemini tool call is invalid.");
    }

    if (functionCall.name !== "calculator") {
      throw new Error("Requested tool is unavailable.");
    }

    const argumentsValue: unknown = functionCall.arguments;
    if (
      typeof argumentsValue !== "object" ||
      argumentsValue === null ||
      Array.isArray(argumentsValue) ||
      !("expression" in argumentsValue) ||
      typeof argumentsValue.expression !== "string" ||
      Object.keys(argumentsValue).length !== 1
    ) {
      throw new Error("Gemini tool arguments are invalid.");
    }

    this.previousInteractionId = interaction.id;
    this.pendingCallId = functionCall.id;
    this.pendingFunctionName = functionCall.name;

    return {
      type: "tool_call",
      callId: functionCall.id,
      toolName: functionCall.name,
      input: argumentsValue.expression,
    };
  }
}

function getCalculatorFunctionTools(tools: readonly ModelTool[]) {
  const calculator = tools.find((tool) => tool.name === "calculator");
  if (!calculator) {
    return [];
  }

  return [{
    type: "function" as const,
    name: calculator.name,
    description: calculator.description,
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "The arithmetic expression to evaluate.",
        },
      },
      required: ["expression"],
      additionalProperties: false,
    },
  }];
}
