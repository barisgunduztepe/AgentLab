import { FakeModelProvider } from "./providers/fake-model-provider";
import { GeminiModelProvider } from "./providers/gemini-model-provider";
import { OpenAIModelProvider } from "./providers/openai-model-provider";
import { RetryingModelProvider } from "./providers/retrying-model-provider";
import type { ModelProvider, ModelResponse } from "./model-provider";

export function createModelProvider(options: { fakeResponses?: readonly ModelResponse[] } = {}): ModelProvider {
  switch (process.env.AGENTLAB_MODEL_PROVIDER) {
    case "fake":
      return new FakeModelProvider(options.fakeResponses);
    case "openai":
      return new RetryingModelProvider(new OpenAIModelProvider());
    case "gemini":
      return new RetryingModelProvider(new GeminiModelProvider());
    default:
      throw new Error("AGENTLAB_MODEL_PROVIDER must be set to 'fake', 'openai', or 'gemini'.");
  }
}
