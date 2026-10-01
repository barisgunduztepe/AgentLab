import OpenAI from "openai";
import { APIConnectionError, APIError, APIUserAbortError } from "openai";
import type { ModelProvider, ModelResponse, ModelTool } from "../model-provider";
import { RetryableProviderError } from "../retryable-provider-error";

export class OpenAIModelProvider implements ModelProvider {
  private readonly client: OpenAI;
  private readonly model: string;
  private previousResponseId: string | undefined;
  private pendingCallId: string | undefined;
  private tools: readonly ModelTool[] = [];

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL;

    if (!apiKey?.trim()) {
      throw new Error("OPENAI_API_KEY is not configured.");
    }

    if (!model?.trim()) {
      throw new Error("OPENAI_MODEL is not configured.");
    }

    this.model = model.trim();
    this.client = new OpenAI({ apiKey, maxRetries: 0 });
  }

  async generateResponse(prompt: string, tools: readonly ModelTool[] = []): Promise<ModelResponse> {
    this.tools = tools;
    this.pendingCallId = undefined;

    const response = await this.createResponse({
      model: this.model,
      input: prompt,
      tools: getCalculatorFunctionTools(tools),
      parallel_tool_calls: false,
      tool_choice: "auto",
    });

    return this.readResponse(response);
  }

  async continueAfterToolCall(callId: string, output: string): Promise<ModelResponse> {
    if (!this.pendingCallId || callId !== this.pendingCallId || !this.previousResponseId) {
      throw new Error("Tool call continuation is invalid.");
    }

    const response = await this.createResponse({
      model: this.model,
      previous_response_id: this.previousResponseId,
      input: [{
        type: "function_call_output",
        call_id: callId,
        output,
      }],
      tools: getCalculatorFunctionTools(this.tools),
      parallel_tool_calls: false,
      tool_choice: "auto",
    });

    return this.readResponse(response);
  }

  private async createResponse(
    params: OpenAI.Responses.ResponseCreateParamsNonStreaming,
  ): Promise<OpenAI.Responses.Response> {
    try {
      return await this.client.responses.create(params);
    } catch (error) {
      if (isRetryableOpenAIError(error)) {
        throw new RetryableProviderError();
      }
      throw new Error("OpenAI request failed.");
    }
  }

  private readResponse(response: OpenAI.Responses.Response): ModelResponse {
    if (response.status !== "completed") {
      throw new Error("OpenAI response was not completed.");
    }

    this.previousResponseId = response.id;
    const functionCalls = response.output.filter((item) => item.type === "function_call");

    if (functionCalls.length > 1) {
      throw new Error("Multiple tool calls are not supported.");
    }

    const functionCall = functionCalls[0];
    if (!functionCall) {
      this.pendingCallId = undefined;
      return { type: "text", text: response.output_text };
    }

    if (!functionCall.call_id.trim() || !functionCall.name.trim()) {
      throw new Error("OpenAI tool call is invalid.");
    }

    let parsedArguments: unknown;
    try {
      parsedArguments = JSON.parse(functionCall.arguments);
    } catch {
      throw new Error("OpenAI tool arguments are invalid.");
    }

    if (
      typeof parsedArguments !== "object" ||
      parsedArguments === null ||
      !("expression" in parsedArguments) ||
      typeof parsedArguments.expression !== "string"
    ) {
      throw new Error("OpenAI tool arguments are invalid.");
    }

    this.pendingCallId = functionCall.call_id;
    return {
      type: "tool_call",
      callId: functionCall.call_id,
      toolName: functionCall.name,
      input: parsedArguments.expression,
    };
  }
}

function isRetryableOpenAIError(error: unknown): boolean {
  if (error instanceof APIUserAbortError) {
    return false;
  }

  if (error instanceof APIConnectionError) {
    return true;
  }

  if (!(error instanceof APIError)) {
    return false;
  }

  if ([408, 500, 502, 503, 504].includes(error.status ?? -1)) {
    return true;
  }

  return error.status === 429 && error.code === "rate_limit_exceeded";
}

function getCalculatorFunctionTools(tools: readonly ModelTool[]): OpenAI.Responses.FunctionTool[] {
  const calculator = tools.find((tool) => tool.name === "calculator");
  if (!calculator) {
    return [];
  }

  return [{
    type: "function",
    name: calculator.name,
    description: calculator.description,
    strict: true,
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
