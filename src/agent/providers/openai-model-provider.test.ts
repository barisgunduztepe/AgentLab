import { APIConnectionError, APIError, APIUserAbortError } from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAIModelProvider } from "./openai-model-provider";
import { RetryableProviderError } from "../retryable-provider-error";

const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  constructor: vi.fn(),
  APIError: class MockAPIError extends Error {
    status: number | undefined;
    code: string | undefined;

    constructor(status: number | undefined, error?: { code?: string }) {
      super("private structured SDK error details");
      this.status = status;
      this.code = error?.code;
    }
  },
  APIConnectionError: class MockAPIConnectionError extends Error {
    constructor() { super("transport"); }
  },
  APIUserAbortError: class MockAPIUserAbortError extends Error {
    constructor() { super("aborted"); }
  },
}));

vi.mock("openai", () => ({
  default: class OpenAI {
    responses = { create: sdk.create };

    constructor(options: { apiKey: string; maxRetries: number }) {
      sdk.constructor(options);
    }
  },
  APIError: sdk.APIError,
  APIConnectionError: sdk.APIConnectionError,
  APIUserAbortError: sdk.APIUserAbortError,
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

function makeAPIError(status: number, code?: string): APIError {
  return new APIError(
    status,
    code ? { code } : undefined,
    "private structured SDK error details",
    new Headers(),
  );
}

describe("OpenAIModelProvider error policy", () => {
  it.each([
    [makeAPIError(503), true], [makeAPIError(429, "rate_limit_exceeded"), true],
    [makeAPIError(429, "insufficient_quota"), false], [makeAPIError(401), false],
    [new APIConnectionError({ message: "transport" }), true],
    [new APIUserAbortError({ message: "aborted" }), false], [new Error("private key"), false],
  ])("classifies transport failures without leaking details", async (error, retryable) => {
    sdk.create.mockRejectedValueOnce(error);
    const request = new OpenAIModelProvider().complete({ messages: [{ role: "user", text: "Task" }], tools: [] });
    if (retryable) await expect(request).rejects.toBeInstanceOf(RetryableProviderError);
    else await expect(request).rejects.toThrow("OpenAI request failed.");
  });
  it("requires server-side key and model", () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => new OpenAIModelProvider()).toThrow();
    process.env.OPENAI_API_KEY = "test-only-key";
    delete process.env.OPENAI_MODEL;
    expect(() => new OpenAIModelProvider()).toThrow();
  });
});
