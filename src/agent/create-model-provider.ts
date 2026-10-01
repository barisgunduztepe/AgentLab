import { FakeModelProvider } from "./providers/fake-model-provider";
import { OpenAIModelProvider } from "./providers/openai-model-provider";
import type { ModelProvider } from "./model-provider";

export function createModelProvider(): ModelProvider {
  switch (process.env.AGENTLAB_MODEL_PROVIDER) {
    case "fake":
      return new FakeModelProvider();
    case "openai":
      return new OpenAIModelProvider();
    default:
      throw new Error("AGENTLAB_MODEL_PROVIDER must be set to 'fake' or 'openai'.");
  }
}
