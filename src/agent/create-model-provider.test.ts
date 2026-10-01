import { afterEach, describe, expect, it } from "vitest";
import { createModelProvider } from "./create-model-provider";
import { FakeModelProvider } from "./providers/fake-model-provider";
import { OpenAIModelProvider } from "./providers/openai-model-provider";

const envNames = ["AGENTLAB_MODEL_PROVIDER", "OPENAI_API_KEY", "OPENAI_MODEL"] as const;
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

  it.each([undefined, "", "groq", "OpenAI"])("rejects missing or invalid provider selection: %s", (value) => {
    if (value === undefined) {
      delete process.env.AGENTLAB_MODEL_PROVIDER;
    } else {
      process.env.AGENTLAB_MODEL_PROVIDER = value;
    }

    expect(createModelProvider).toThrow("AGENTLAB_MODEL_PROVIDER must be set to 'fake' or 'openai'.");
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

    expect(createModelProvider()).toBeInstanceOf(OpenAIModelProvider);
  });
});
