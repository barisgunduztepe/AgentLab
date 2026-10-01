import { FakeModelProvider } from "./providers/fake-model-provider";
import { GeminiModelProvider } from "./providers/gemini-model-provider";
import { OpenAIModelProvider } from "./providers/openai-model-provider";
import { RetryingModelProvider } from "./providers/retrying-model-provider";
import type { ModelProvider, ModelResponse } from "./model-provider";

export function createModelProvider(options: { fakeResponses?: readonly ModelResponse[] } = {}): ModelProvider {
  return createFromConfiguration(resolveConfiguration(), options.fakeResponses);
}

export function createComparisonModelProviders(fixtures?: {
  baseline: readonly ModelResponse[];
  structured: readonly ModelResponse[];
}): [ModelProvider, ModelProvider] {
  const configuration = resolveConfiguration();
  return [
    createFromConfiguration(configuration, fixtures?.baseline),
    createFromConfiguration(configuration, fixtures?.structured),
  ];
}

type ProviderConfiguration =
  | { provider: "fake" }
  | { provider: "openai" | "gemini"; apiKey: string; model: string };

function resolveConfiguration(): ProviderConfiguration {
  switch (process.env.AGENTLAB_MODEL_PROVIDER) {
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
      throw new Error("AGENTLAB_MODEL_PROVIDER must be set to 'fake', 'openai', or 'gemini'.");
  }
}

function createFromConfiguration(
  configuration: ProviderConfiguration,
  fakeResponses?: readonly ModelResponse[],
): ModelProvider {
  switch (configuration.provider) {
    case "fake":
      return new FakeModelProvider(fakeResponses);
    case "openai":
      return new RetryingModelProvider(new OpenAIModelProvider(configuration));
    case "gemini":
      return new RetryingModelProvider(new GeminiModelProvider(configuration));
  }
}
