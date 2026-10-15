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

describe("GeminiModelProvider error policy", () => {
  it.each([
    [{ status: 503 }, true], [{ status: 429, error: { details: [{ reason: "RATE_LIMIT_EXCEEDED" }] } }, true],
    [{ status: 429, error: { status: "RESOURCE_EXHAUSTED" } }, false], [{ status: 401 }, false],
    [{ name: "APIConnectionTimeoutError" }, true], [{ name: "APIUserAbortError" }, false], [new Error("private key"), false],
  ])("classifies transport failures without leaking details", async (error, retryable) => {
    sdk.create.mockRejectedValueOnce(error);
    const request = new GeminiModelProvider().complete({ messages: [{ role: "user", text: "Task" }], tools: [] });
    if (retryable) await expect(request).rejects.toBeInstanceOf(RetryableProviderError);
    else await expect(request).rejects.toThrow("Gemini request failed.");
  });
  it("requires server-side key and model", () => {
    delete process.env.GEMINI_API_KEY;
    expect(() => new GeminiModelProvider()).toThrow();
    process.env.GEMINI_API_KEY = "test-only-key";
    delete process.env.GEMINI_MODEL;
    expect(() => new GeminiModelProvider()).toThrow();
  });
});
