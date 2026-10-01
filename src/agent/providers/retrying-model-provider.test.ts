import { describe, expect, it, vi } from "vitest";
import type { ModelProvider, ModelResponse } from "../model-provider";
import { RetryableProviderError } from "../retryable-provider-error";
import { RetryingModelProvider, type RetryRuntime } from "./retrying-model-provider";

const textResponse: ModelResponse = { type: "text", text: "Finished." };

function makeRuntime(randomValue = 0.5) {
  return {
    sleep: vi.fn(async () => {}),
    random: vi.fn(() => randomValue),
  } satisfies RetryRuntime;
}

function makeProvider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    async generateResponse() { return textResponse; },
    async continueAfterToolCall() { return textResponse; },
    ...overrides,
  };
}

describe("RetryingModelProvider", () => {
  it("retries a retryable failure and returns the later response", async () => {
    const generateResponse = vi.fn()
      .mockRejectedValueOnce(new RetryableProviderError())
      .mockResolvedValueOnce(textResponse);
    const runtime = makeRuntime(0);
    const provider = new RetryingModelProvider(makeProvider({ generateResponse }), runtime);

    await expect(provider.generateResponse("task")).resolves.toEqual(textResponse);
    expect(generateResponse).toHaveBeenCalledTimes(2);
    expect(runtime.sleep).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("stops after three total attempts", async () => {
    const generateResponse = vi.fn().mockRejectedValue(new RetryableProviderError());
    const runtime = makeRuntime(0);
    const provider = new RetryingModelProvider(makeProvider({ generateResponse }), runtime);

    await expect(provider.generateResponse("task")).rejects.toBeInstanceOf(RetryableProviderError);
    expect(generateResponse).toHaveBeenCalledTimes(3);
    expect(runtime.sleep).toHaveBeenCalledTimes(2);
  });

  it("does not retry permanent failures", async () => {
    const error = new Error("safe permanent failure");
    const generateResponse = vi.fn().mockRejectedValue(error);
    const runtime = makeRuntime();
    const provider = new RetryingModelProvider(makeProvider({ generateResponse }), runtime);

    await expect(provider.generateResponse("task")).rejects.toBe(error);
    expect(generateResponse).toHaveBeenCalledOnce();
    expect(runtime.sleep).not.toHaveBeenCalled();
  });

  it("uses exponential caps and full jitter", async () => {
    const generateResponse = vi.fn()
      .mockRejectedValueOnce(new RetryableProviderError())
      .mockRejectedValueOnce(new RetryableProviderError())
      .mockResolvedValueOnce(textResponse);
    const runtime = makeRuntime(0.5);
    const provider = new RetryingModelProvider(makeProvider({ generateResponse }), runtime);

    await expect(provider.generateResponse("task")).resolves.toEqual(textResponse);
    expect(runtime.sleep.mock.calls).toEqual([[250], [500]]);
    expect(runtime.random).toHaveBeenCalledTimes(2);
  });

  it("clamps injected random values to the full-jitter range", async () => {
    const generateResponse = vi.fn()
      .mockRejectedValueOnce(new RetryableProviderError())
      .mockResolvedValueOnce(textResponse);
    const runtime = { sleep: vi.fn(async () => {}), random: () => 2 };
    const provider = new RetryingModelProvider(makeProvider({ generateResponse }), runtime);

    await expect(provider.generateResponse("task")).resolves.toEqual(textResponse);
    expect(runtime.sleep).toHaveBeenCalledExactlyOnceWith(500);
  });
});
