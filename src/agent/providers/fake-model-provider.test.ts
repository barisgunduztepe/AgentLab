import { describe, expect, it } from "vitest";
import { FakeModelProvider } from "./fake-model-provider";

describe("FakeModelProvider", () => {
  it("returns its default deterministic text response", async () => {
    await expect(new FakeModelProvider().generateResponse("Say hello")).resolves.toEqual({
      type: "text",
      text: "[Fake Model] Task received: Say hello",
    });
  });

  it("can return a deterministic structured tool call", async () => {
    const response = { type: "tool_call" as const, toolName: "calculator", input: "12 * 8" };

    await expect(new FakeModelProvider([response]).generateResponse("Calculate 12 * 8")).resolves.toEqual(response);
  });

  it("returns sequential responses and rejects after the sequence is exhausted", async () => {
    const responses = [
      { type: "tool_call" as const, toolName: "calculator", input: "12 * 8" },
      { type: "text" as const, text: "The answer is 96." },
    ];
    const provider = new FakeModelProvider(responses);

    await expect(provider.generateResponse("Initial task")).resolves.toEqual(responses[0]);
    await expect(provider.generateResponse("Continuation")).resolves.toEqual(responses[1]);
    await expect(provider.generateResponse("Unexpected extra call")).rejects.toThrow(
      "FakeModelProvider response sequence is exhausted.",
    );
  });
});
