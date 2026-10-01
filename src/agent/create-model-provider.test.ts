import { afterEach, describe, expect, it } from "vitest";
import { createComparisonModelProviders, createModelProvider } from "./create-model-provider";
import { FakeModelProvider } from "./providers/fake-model-provider";
import { RetryingModelProvider } from "./providers/retrying-model-provider";

const envNames = ["AGENTLAB_MODEL_PROVIDER", "OPENAI_API_KEY", "OPENAI_MODEL", "GEMINI_API_KEY", "GEMINI_MODEL"] as const;
const previousEnv = new Map(envNames.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of envNames) {
    const previousValue = previousEnv.get(name);
    if (previousValue === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previousValue;
    }
  }
});

describe("createModelProvider", () => {
  it("selects the fake provider only when explicitly configured", () => {
    process.env.AGENTLAB_MODEL_PROVIDER = "fake";

    expect(createModelProvider()).toBeInstanceOf(FakeModelProvider);
  });

  it("creates two separate deterministic Fake providers from one explicit configuration", async () => {
    process.env.AGENTLAB_MODEL_PROVIDER = "fake";
    const responses = [{ type: "text" as const, text: "fixture response" }];
    const [baseline, structured] = createComparisonModelProviders({ baseline: responses, structured: [...responses] });

    expect(baseline).toBeInstanceOf(FakeModelProvider);
    expect(structured).toBeInstanceOf(FakeModelProvider);
    expect(baseline).not.toBe(structured);
    await expect(baseline.generateResponse("same task")).resolves.toEqual(responses[0]);
    await expect(structured.generateResponse("same task")).resolves.toEqual(responses[0]);
  });

  it.each(["openai", "gemini"] as const)("resolves %s model configuration once and creates isolated retry-wrapped providers", (provider) => {
    process.env.AGENTLAB_MODEL_PROVIDER = provider;
    if (provider === "openai") {
      process.env.OPENAI_API_KEY = "private-test-key";
      process.env.OPENAI_MODEL = "test-openai-model";
    } else {
      process.env.GEMINI_API_KEY = "private-test-key";
      process.env.GEMINI_MODEL = "test-gemini-model";
    }

    const [first, second] = createComparisonModelProviders();
    expect(first).toBeInstanceOf(RetryingModelProvider);
    expect(second).toBeInstanceOf(RetryingModelProvider);
    expect(first).not.toBe(second);
    const firstSdkProvider = (first as unknown as { provider: { model: string; client: object } }).provider;
    const secondSdkProvider = (second as unknown as { provider: { model: string; client: object } }).provider;
    expect(firstSdkProvider.model).toBe(secondSdkProvider.model);
    expect(firstSdkProvider.client).not.toBe(secondSdkProvider.client);
  });

  it("uses an optional response fixture only when FakeModelProvider is explicitly selected", async () => {
    process.env.AGENTLAB_MODEL_PROVIDER = "fake";
    const fakeResponses = [{ type: "text" as const, text: "Scenario fixture response." }];

    await expect(createModelProvider({ fakeResponses }).generateResponse("Scenario task.")).resolves.toEqual(
      fakeResponses[0],
    );
  });

  it.each([undefined, "", "groq", "OpenAI"])("rejects missing or invalid provider selection: %s", (value) => {
    if (value === undefined) {
      delete process.env.AGENTLAB_MODEL_PROVIDER;
    } else {
      process.env.AGENTLAB_MODEL_PROVIDER = value;
    }

    expect(createModelProvider).toThrow("AGENTLAB_MODEL_PROVIDER must be set to 'fake', 'openai', or 'gemini'.");
  });

  it("requires server-side OpenAI credentials and model configuration", () => {
    process.env.AGENTLAB_MODEL_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;

    expect(createModelProvider).toThrow("OPENAI_API_KEY is not configured.");

    process.env.OPENAI_API_KEY = "test-key";
    expect(createModelProvider).toThrow("OPENAI_MODEL is not configured.");
  });

  it("creates the OpenAI provider when all required values are configured", () => {
    process.env.AGENTLAB_MODEL_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "gpt-6-luna";

    expect(createModelProvider({ fakeResponses: [{ type: "text", text: "ignored" }] })).toBeInstanceOf(
      RetryingModelProvider,
    );
  });

  it("requires server-side Gemini credentials and model configuration", () => {
    process.env.AGENTLAB_MODEL_PROVIDER = "gemini";
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;

    expect(createModelProvider).toThrow("GEMINI_API_KEY is not configured.");

    process.env.GEMINI_API_KEY = "test-key";
    expect(createModelProvider).toThrow("GEMINI_MODEL is not configured.");
  });

  it("creates the Gemini provider when all required values are configured", () => {
    process.env.AGENTLAB_MODEL_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_MODEL = "gemini-test-model";

    expect(createModelProvider({ fakeResponses: [{ type: "text", text: "ignored" }] })).toBeInstanceOf(
      RetryingModelProvider,
    );
  });

  it.each(["openai", "gemini"] as const)("creates independent retry-wrapped %s providers for separate agents", (provider) => {
    process.env.AGENTLAB_MODEL_PROVIDER = provider;
    if (provider === "openai") {
      process.env.OPENAI_API_KEY = "test-key";
      process.env.OPENAI_MODEL = "gpt-6-luna";
    } else {
      process.env.GEMINI_API_KEY = "test-key";
      process.env.GEMINI_MODEL = "gemini-test-model";
    }

    const analystProvider = createModelProvider();
    const finalizerProvider = createModelProvider();

    expect(analystProvider).toBeInstanceOf(RetryingModelProvider);
    expect(finalizerProvider).toBeInstanceOf(RetryingModelProvider);
    expect(analystProvider).not.toBe(finalizerProvider);
  });
});
