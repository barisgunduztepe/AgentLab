import type { Interactions } from "@google/genai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiModelProvider } from "./gemini-model-provider";
import { RetryableProviderError } from "../retryable-provider-error";

const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  constructor: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class GoogleGenAI {
    interactions = { create: sdk.create };

    constructor(options: { apiKey: string }) {
      sdk.constructor(options);
    }
  },
}));

const originalApiKey = process.env.GEMINI_API_KEY;
const originalModel = process.env.GEMINI_MODEL;

beforeEach(() => {
  sdk.create.mockReset();
  sdk.constructor.mockReset();
  process.env.GEMINI_API_KEY = "test-only-key";
  process.env.GEMINI_MODEL = "test-model";
});

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalApiKey;
  if (originalModel === undefined) delete process.env.GEMINI_MODEL;
  else process.env.GEMINI_MODEL = originalModel;
});

function makeInteraction(
  id: string,
  steps: Interactions.Step[],
  outputText?: string,
  status: Interactions.Interaction["status"] = "completed",
): Interactions.Interaction {
  return {
    id,
    status,
    steps,
    output_text: outputText,
  } as Interactions.Interaction;
}

function functionCall(id: string, name = "calculator", args: Record<string, unknown> = { expression: "12 * 8" }) {
  return { type: "function_call" as const, id, name, arguments: args };
}

const calculator = {
  name: "calculator",
  description: "Evaluates basic arithmetic expressions.",
};

describe("GeminiModelProvider", () => {
  it("declares the calculator function and maps a text response", async () => {
    sdk.create.mockResolvedValueOnce(makeInteraction("interaction-1", [
      { type: "model_output", content: [{ type: "text", text: "Hello." }] },
    ], "Hello."));
    const provider = new GeminiModelProvider();

    await expect(provider.generateResponse("Say hello.", [calculator])).resolves.toEqual({
      type: "text",
      text: "Hello.",
    });

    expect(sdk.constructor).toHaveBeenCalledWith({ apiKey: "test-only-key" });
    expect(sdk.create).toHaveBeenCalledWith({
      model: "test-model",
      input: "Say hello.",
      stream: false,
      tools: [{
        type: "function",
        name: "calculator",
        description: calculator.description,
        parameters: {
          type: "object",
          properties: { expression: { type: "string", description: "The arithmetic expression to evaluate." } },
          required: ["expression"],
          additionalProperties: false,
        },
      }],
    }, { maxRetries: 0 });
  });

  it("maps one native function call and returns its result using matching IDs", async () => {
    sdk.create
      .mockResolvedValueOnce(makeInteraction("interaction-1", [functionCall("native-call-1")], undefined, "requires_action"))
      .mockResolvedValueOnce(makeInteraction("interaction-2", [], "The answer is 96."));
    const provider = new GeminiModelProvider();

    await expect(provider.generateResponse("Calculate 12 * 8.", [calculator])).resolves.toEqual({
      type: "tool_call",
      callId: "native-call-1",
      toolName: "calculator",
      input: "12 * 8",
    });
    await expect(provider.continueAfterToolCall("native-call-1", "96")).resolves.toEqual({
      type: "text",
      text: "The answer is 96.",
    });

    expect(sdk.create).toHaveBeenNthCalledWith(2, {
      model: "test-model",
      previous_interaction_id: "interaction-1",
      stream: false,
      input: [{
        type: "function_result",
        name: "calculator",
        call_id: "native-call-1",
        result: "96",
      }],
      tools: [{
        type: "function",
        name: "calculator",
        description: calculator.description,
        parameters: expect.any(Object),
      }],
    }, { maxRetries: 0 });
  });

  it("rejects a mismatched call ID without making a continuation request", async () => {
    sdk.create.mockResolvedValueOnce(makeInteraction("interaction-1", [functionCall("expected-call")], undefined, "requires_action"));
    const provider = new GeminiModelProvider();
    await provider.generateResponse("Calculate 12 * 8.", [calculator]);

    await expect(provider.continueAfterToolCall("other-call", "96")).rejects.toThrow(
      "Tool call continuation is invalid.",
    );
    expect(sdk.create).toHaveBeenCalledOnce();
  });

  it("preserves continuation state after a retryable request failure", async () => {
    sdk.create
      .mockResolvedValueOnce(makeInteraction("interaction-1", [functionCall("native-call-1")], undefined, "requires_action"))
      .mockRejectedValueOnce({ name: "ApiError", status: 503, error: { status: "UNAVAILABLE" } })
      .mockResolvedValueOnce(makeInteraction("interaction-2", [], "The answer is 96."));
    const provider = new GeminiModelProvider();
    await provider.generateResponse("Calculate 12 * 8.", [calculator]);

    await expect(provider.continueAfterToolCall("native-call-1", "96")).rejects.toBeInstanceOf(RetryableProviderError);
    await expect(provider.continueAfterToolCall("native-call-1", "96")).resolves.toEqual({
      type: "text",
      text: "The answer is 96.",
    });
    expect(sdk.create.mock.calls[1]).toEqual(sdk.create.mock.calls[2]);
  });

  it("classifies Gemini 503 as retryable without exposing provider details", async () => {
    sdk.create.mockRejectedValueOnce({
      name: "ApiError",
      status: 503,
      error: { status: "UNAVAILABLE", message: "private provider details" },
    });
    const provider = new GeminiModelProvider();

    await expect(provider.generateResponse("Say hello.")).rejects.toMatchObject({
      name: "RetryableProviderError",
      message: "Provider request failed.",
    });
  });

  it("retries only an explicit Gemini rate-limit reason, not ambiguous resource exhaustion", async () => {
    sdk.create.mockRejectedValueOnce({
      name: "RateLimitError",
      status: 429,
      error: { status: "RESOURCE_EXHAUSTED", details: [{ reason: "RATE_LIMIT_EXCEEDED" }] },
    });
    const provider = new GeminiModelProvider();
    await expect(provider.generateResponse("Say hello.")).rejects.toBeInstanceOf(RetryableProviderError);

    sdk.create.mockRejectedValueOnce({
      name: "RateLimitError",
      status: 429,
      error: { status: "RESOURCE_EXHAUSTED" },
    });
    await expect(provider.generateResponse("Say hello.")).rejects.toThrow("Gemini request failed.");
  });

  it("classifies Gemini transport failures but not aborts or unknown errors", async () => {
    sdk.create.mockRejectedValueOnce({ name: "APIConnectionTimeoutError" });
    const provider = new GeminiModelProvider();
    await expect(provider.generateResponse("Say hello.")).rejects.toBeInstanceOf(RetryableProviderError);

    sdk.create.mockRejectedValueOnce({ name: "APIUserAbortError" });
    await expect(provider.generateResponse("Say hello.")).rejects.toThrow("Gemini request failed.");

    sdk.create.mockRejectedValueOnce(new Error("unknown failure"));
    await expect(provider.generateResponse("Say hello.")).rejects.toThrow("Gemini request failed.");
  });

  it.each([
    null,
    [],
    { expression: 4 },
    { expression: "1 + 1", extra: true },
  ])("rejects malformed calculator arguments: %j", async (args) => {
    sdk.create.mockResolvedValueOnce(makeInteraction("interaction-1", [functionCall(
      "native-call-1",
      "calculator",
      args as Record<string, unknown>,
    )], undefined, "requires_action"));
    const provider = new GeminiModelProvider();

    await expect(provider.generateResponse("Calculate.", [calculator])).rejects.toThrow(
      "Gemini tool arguments are invalid.",
    );
  });

  it("rejects an unsupported function without returning it for execution", async () => {
    sdk.create.mockResolvedValueOnce(makeInteraction("interaction-1", [functionCall("call-1", "unknown_tool")], undefined, "requires_action"));
    const provider = new GeminiModelProvider();

    await expect(provider.generateResponse("Do something.", [calculator])).rejects.toThrow(
      "Requested tool is unavailable.",
    );
  });

  it("rejects multiple function calls in one interaction", async () => {
    sdk.create.mockResolvedValueOnce(makeInteraction("interaction-1", [
      functionCall("call-1"),
      functionCall("call-2"),
    ], undefined, "requires_action"));
    const provider = new GeminiModelProvider();

    await expect(provider.generateResponse("Calculate.", [calculator])).rejects.toThrow(
      "Multiple tool calls are not supported.",
    );
  });

  it("rejects requires_action without a function call", async () => {
    sdk.create.mockResolvedValueOnce(makeInteraction("interaction-1", [], undefined, "requires_action"));
    const provider = new GeminiModelProvider();

    await expect(provider.generateResponse("Calculate.", [calculator])).rejects.toThrow(
      "Gemini response was not completed.",
    );
  });

  it("rejects a function call incorrectly marked completed", async () => {
    sdk.create.mockResolvedValueOnce(makeInteraction("interaction-1", [functionCall("call-1")]));
    const provider = new GeminiModelProvider();

    await expect(provider.generateResponse("Calculate.", [calculator])).rejects.toThrow(
      "Gemini tool call response status is invalid.",
    );
  });

  it("requires server-side API key and model configuration", () => {
    delete process.env.GEMINI_API_KEY;
    expect(() => new GeminiModelProvider()).toThrow("GEMINI_API_KEY is not configured.");

    process.env.GEMINI_API_KEY = "test-only-key";
    delete process.env.GEMINI_MODEL;
    expect(() => new GeminiModelProvider()).toThrow("GEMINI_MODEL is not configured.");
  });

  it("sanitizes SDK errors", async () => {
    sdk.create.mockRejectedValueOnce(new Error("raw credential test-only-key provider details"));
    const provider = new GeminiModelProvider();

    await expect(provider.generateResponse("Say hello.")).rejects.toThrow("Gemini request failed.");
  });
});
