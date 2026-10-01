import OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAIModelProvider } from "./openai-model-provider";

const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  constructor: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class OpenAI {
    responses = { create: sdk.create };

    constructor(options: { apiKey: string }) {
      sdk.constructor(options);
    }
  },
}));

const originalApiKey = process.env.OPENAI_API_KEY;
const originalModel = process.env.OPENAI_MODEL;

beforeEach(() => {
  sdk.create.mockReset();
  sdk.constructor.mockReset();
  process.env.OPENAI_API_KEY = "test-only-key";
  process.env.OPENAI_MODEL = "test-model";
});

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
  if (originalModel === undefined) delete process.env.OPENAI_MODEL;
  else process.env.OPENAI_MODEL = originalModel;
});

function makeResponse(
  id: string,
  output: OpenAI.Responses.ResponseOutputItem[],
  outputText = "",
): OpenAI.Responses.Response {
  return {
    id,
    status: "completed",
    output,
    output_text: outputText,
  } as OpenAI.Responses.Response;
}

function functionCall(callId: string, name = "calculator", args = '{"expression":"12 * 8"}') {
  return { type: "function_call" as const, call_id: callId, name, arguments: args };
}

const calculator = {
  name: "calculator",
  description: "Evaluates basic arithmetic expressions.",
};

describe("OpenAIModelProvider", () => {
  it("declares the calculator function and maps the native function call", async () => {
    sdk.create.mockResolvedValueOnce(makeResponse("resp-1", [functionCall("call-1")]));
    const provider = new OpenAIModelProvider();

    await expect(provider.generateResponse("Calculate 12 times 8.", [calculator])).resolves.toEqual({
      type: "tool_call",
      callId: "call-1",
      toolName: "calculator",
      input: "12 * 8",
    });

    expect(sdk.create).toHaveBeenCalledWith({
      model: "test-model",
      input: "Calculate 12 times 8.",
      tools: [{
        type: "function",
        name: "calculator",
        description: calculator.description,
        strict: true,
        parameters: {
          type: "object",
          properties: { expression: { type: "string", description: "The arithmetic expression to evaluate." } },
          required: ["expression"],
          additionalProperties: false,
        },
      }],
      parallel_tool_calls: false,
      tool_choice: "auto",
    });
  });

  it("returns tool output with the matching call id and previous response id", async () => {
    sdk.create
      .mockResolvedValueOnce(makeResponse("resp-1", [functionCall("call-1")]))
      .mockResolvedValueOnce(makeResponse("resp-2", [], "The answer is 96."));
    const provider = new OpenAIModelProvider();

    await provider.generateResponse("Calculate 12 * 8.", [calculator]);
    await expect(provider.continueAfterToolCall("call-1", "96")).resolves.toEqual({
      type: "text",
      text: "The answer is 96.",
    });

    expect(sdk.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      model: "test-model",
      previous_response_id: "resp-1",
      input: [{ type: "function_call_output", call_id: "call-1", output: "96" }],
      parallel_tool_calls: false,
    }));
  });

  it("rejects a mismatched call id without making a continuation request", async () => {
    sdk.create.mockResolvedValueOnce(makeResponse("resp-1", [functionCall("expected-call")]));
    const provider = new OpenAIModelProvider();
    await provider.generateResponse("Calculate 12 * 8.", [calculator]);

    await expect(provider.continueAfterToolCall("other-call", "96")).rejects.toThrow(
      "Tool call continuation is invalid.",
    );
    expect(sdk.create).toHaveBeenCalledOnce();
  });

  it("fails safely when the model returns multiple function calls", async () => {
    sdk.create.mockResolvedValueOnce(makeResponse("resp-1", [
      functionCall("call-1"),
      functionCall("call-2"),
    ]));
    const provider = new OpenAIModelProvider();

    await expect(provider.generateResponse("Calculate something.", [calculator])).rejects.toThrow(
      "Multiple tool calls are not supported.",
    );
  });

  it.each([
    "not-json",
    "[]",
    '{"expression":4}',
  ])("fails safely for invalid calculator arguments: %s", async (argumentsJson) => {
    sdk.create.mockResolvedValueOnce(makeResponse("resp-1", [functionCall("call-1", "calculator", argumentsJson)]));
    const provider = new OpenAIModelProvider();

    await expect(provider.generateResponse("Calculate something.", [calculator])).rejects.toThrow(
      "OpenAI tool arguments are invalid.",
    );
  });

  it("does not expose raw API errors", async () => {
    sdk.create.mockRejectedValueOnce(new Error("raw key=test-only-key provider response"));
    const provider = new OpenAIModelProvider();

    await expect(provider.generateResponse("Say hello.")).rejects.toThrow("OpenAI request failed.");
  });
});
