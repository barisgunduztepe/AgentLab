import { describe, expect, it } from "vitest";
import { FakeModelProvider } from "./fake-model-provider";
import type { CompleteRequest } from "../model-provider";
const initial: CompleteRequest = { messages: [{ role: "user", text: "Say hello" }], tools: [] };
describe("FakeModelProvider", () => {
  it("returns deterministic default text without invented usage", async () => {
    const provider = new FakeModelProvider();
    await expect(provider.complete(initial)).resolves.toEqual({ type: "text", text: "[Fake Model] Task received: Say hello", finishReason: "stop", usage: null });
    await expect(provider.complete(initial)).resolves.toEqual(await provider.complete(initial));
  });
  it("derives its script position from the transcript and rejects mismatched turns", async () => {
    const call = { callId: "one", toolName: "calculator", arguments: { expression: "1+1" } };
    const provider = new FakeModelProvider([{ type: "tool_call", call }, { type: "text", text: "2" }]);
    const next: CompleteRequest = { ...initial, messages: [...initial.messages,
      { role: "assistant", type: "tool_call", call }, { role: "tool", callId: "one", toolName: "calculator", output: "2" }] };
    await expect(provider.complete(next)).resolves.toMatchObject({ type: "text", text: "2" });
    await expect(provider.complete(initial)).resolves.toMatchObject({ type: "tool_call", call });
    await expect(provider.complete(next)).resolves.toMatchObject({ type: "text", text: "2" });
    await expect(provider.complete({ ...initial, messages: [...initial.messages, { role: "assistant", type: "text", text: "wrong" }] })).rejects.toThrow();
  });
});
