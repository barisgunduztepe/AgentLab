import { describe, expect, it } from "vitest";
import type { ModelProvider } from "./model-provider";
import { SingleAgent } from "./single-agent";

describe("SingleAgent", () => {
  it("forwards the task to its provider and returns the provider response", async () => {
    const task = "Summarize the experiment.";
    const providerResponse = "The experiment completed successfully.";
    let receivedPrompt: string | undefined;

    const modelProvider: ModelProvider = {
      async generateText(prompt) {
        receivedPrompt = prompt;
        return providerResponse;
      },
    };
    const agent = new SingleAgent(modelProvider);

    const result = await agent.run(task);

    expect(receivedPrompt).toBe(task);
    expect(result).toBe(providerResponse);
  });
});
