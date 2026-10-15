import { describe, expect, it, vi } from "vitest";
import type { ModelProvider, ModelResponse } from "../model-provider";
import { RetryableProviderError } from "../retryable-provider-error";
import { RetryingModelProvider, type RetryRuntime } from "./retrying-model-provider";

const textResponse: ModelResponse = { type: "text", text: "Finished.", finishReason: "stop", usage: null };

function makeRuntime(randomValue = 0.5) {
  return {
    sleep: vi.fn(async () => {}),
    random: vi.fn(() => randomValue),
  } satisfies RetryRuntime;
}

function makeProvider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    async complete() { return textResponse; },
    ...overrides,
  };
}

describe("RetryingModelProvider", () => {
  it("retries a retryable failure and returns the later response", async () => {
    const complete = vi.fn()
      .mockRejectedValueOnce(new RetryableProviderError())
      .mockResolvedValueOnce(textResponse);
    const runtime = makeRuntime(0);
    const provider = new RetryingModelProvider(makeProvider({ complete }), runtime);

    await expect(provider.complete({ messages: [{ role: "user", text: "task" }], tools: [] })).resolves.toEqual(textResponse);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(runtime.sleep).toHaveBeenCalledExactlyOnceWith(0, undefined);
  });

  it("stops after three total attempts", async () => {
    const complete = vi.fn().mockRejectedValue(new RetryableProviderError());
    const runtime = makeRuntime(0);
    const provider = new RetryingModelProvider(makeProvider({ complete }), runtime);

    await expect(provider.complete({ messages: [{ role: "user", text: "task" }], tools: [] })).rejects.toBeInstanceOf(RetryableProviderError);
    expect(complete).toHaveBeenCalledTimes(3);
    expect(runtime.sleep).toHaveBeenCalledTimes(2);
  });

  it("does not retry permanent failures", async () => {
    const error = new Error("safe permanent failure");
    const complete = vi.fn().mockRejectedValue(error);
    const runtime = makeRuntime();
    const provider = new RetryingModelProvider(makeProvider({ complete }), runtime);

    await expect(provider.complete({ messages: [{ role: "user", text: "task" }], tools: [] })).rejects.toBe(error);
    expect(complete).toHaveBeenCalledOnce();
    expect(runtime.sleep).not.toHaveBeenCalled();
  });

  it("uses exponential caps and full jitter", async () => {
    const complete = vi.fn()
      .mockRejectedValueOnce(new RetryableProviderError())
      .mockRejectedValueOnce(new RetryableProviderError())
      .mockResolvedValueOnce(textResponse);
    const runtime = makeRuntime(0.5);
    const provider = new RetryingModelProvider(makeProvider({ complete }), runtime);

    await expect(provider.complete({ messages: [{ role: "user", text: "task" }], tools: [] })).resolves.toEqual(textResponse);
    expect(runtime.sleep.mock.calls).toEqual([[250, undefined], [500, undefined]]);
    expect(runtime.random).toHaveBeenCalledTimes(2);
  });

  it("clamps injected random values to the full-jitter range", async () => {
    const complete = vi.fn()
      .mockRejectedValueOnce(new RetryableProviderError())
      .mockResolvedValueOnce(textResponse);
    const runtime = { sleep: vi.fn(async () => {}), random: () => 2 };
    const provider = new RetryingModelProvider(makeProvider({ complete }), runtime);

    await expect(provider.complete({ messages: [{ role: "user", text: "task" }], tools: [] })).resolves.toEqual(textResponse);
    expect(runtime.sleep).toHaveBeenCalledExactlyOnceWith(500, undefined);
  });
});
