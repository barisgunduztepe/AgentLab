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

    await expect(new FakeModelProvider(response).generateResponse("Calculate 12 * 8")).resolves.toEqual(response);
  });
});
