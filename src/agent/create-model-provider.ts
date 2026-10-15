import type { FakeResponse } from "./providers/fake-model-provider";
import { FakeModelProvider } from "./providers/fake-model-provider";
import { GeminiModelProvider } from "./providers/gemini-model-provider";
import { OpenAIModelProvider } from "./providers/openai-model-provider";
import { OpenAICompatibleModelProvider, getOpenAICompatibleConfiguration, type OpenAICompatibleConfiguration } from "./providers/openai-compatible-model-provider";
import { RetryingModelProvider } from "./providers/retrying-model-provider";
import type { ModelProvider } from "./model-provider";

export function createModelProvider(options: { fakeResponses?: readonly FakeResponse[] } = {}): ModelProvider {
  return createProviderContext().create(options.fakeResponses);
}

export function createProviderContext() {
  const configuration = resolveConfiguration();
  const description = configuration.provider === "fake" ? { provider: configuration.provider } : { provider: configuration.provider, model: configuration.model };
  return { description, create: (responses?: readonly FakeResponse[]) => createFromConfiguration(configuration, responses) };
}

/** Provider kind and model name for history records. Never includes keys or other credentials. */
export function describeConfiguredProvider(): { provider: "fake" | "openai" | "gemini" | "openai-compatible"; model?: string } {
  const configuration = resolveConfiguration();
  return configuration.provider === "fake"
    ? { provider: "fake" }
    : { provider: configuration.provider, model: configuration.model };
}

type ProviderConfiguration =
  | { provider: "fake" }
  | { provider: "openai" | "gemini"; apiKey: string; model: string }
  | ({ provider: "openai-compatible" } & OpenAICompatibleConfiguration);

function resolveConfiguration(): ProviderConfiguration {
  switch (process.env.AGENTLAB_MODEL_PROVIDER) {
    case "openai-compatible":
      return { provider: "openai-compatible", ...getOpenAICompatibleConfiguration() };
    case "fake":
      return { provider: "fake" };
    case "openai": {
      const apiKey = process.env.OPENAI_API_KEY;
      const model = process.env.OPENAI_MODEL;
      if (!apiKey?.trim()) throw new Error("OPENAI_API_KEY is not configured.");
      if (!model?.trim()) throw new Error("OPENAI_MODEL is not configured.");
      return { provider: "openai", apiKey, model: model.trim() };
    }
    case "gemini": {
      const apiKey = process.env.GEMINI_API_KEY;
      const model = process.env.GEMINI_MODEL;
      if (!apiKey?.trim()) throw new Error("GEMINI_API_KEY is not configured.");
      if (!model?.trim()) throw new Error("GEMINI_MODEL is not configured.");
      return { provider: "gemini", apiKey, model: model.trim() };
    }
    default:
      throw new Error("AGENTLAB_MODEL_PROVIDER must be set to 'fake', 'openai', 'gemini', or 'openai-compatible'.");
  }
}

function createFromConfiguration(
  configuration: ProviderConfiguration,
  fakeResponses?: readonly FakeResponse[],
): ModelProvider {
  switch (configuration.provider) {
    case "openai-compatible":
      return new RetryingModelProvider(new OpenAICompatibleModelProvider(configuration));
    case "fake":
      return new FakeModelProvider(fakeResponses);
    case "openai":
      return new RetryingModelProvider(new OpenAIModelProvider(configuration));
    case "gemini":
      return new RetryingModelProvider(new GeminiModelProvider(configuration));
  }
}
