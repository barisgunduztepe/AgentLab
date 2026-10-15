import { describe, expect, it } from "vitest";
import type { ModelProvider, CompleteRequest } from "./model-provider";
import { FakeModelProvider } from "./providers/fake-model-provider";
import { RetryingModelProvider } from "./providers/retrying-model-provider";
import { SingleAgent } from "./single-agent";
import { TwoAgentHandoffRunner } from "./two-agent-handoff-runner";

const task = "Explain how a household thermostat keeps a room near its target temperature.";
const analystNotes = "It measures room temperature, compares it with a set point, and controls heating or cooling.";

class RecordingProvider implements ModelProvider {
  readonly prompts: string[] = [];
  generateCount = 0;
  continueCount = 0;

  constructor(private readonly response: import("./providers/fake-model-provider").FakeResponse | Error) {}

  async complete(request: CompleteRequest): Promise<import("./model-provider").ModelResponse> {
    this.generateCount += 1;
    this.prompts.push(request.messages.flatMap((m) => m.role === "user" ? [m.text] : [])[0]);
    if (this.response instanceof Error) throw this.response;
    return { ...this.response, finishReason: this.response.finishReason ?? (this.response.type === "text" ? "stop" : "tool_call"), usage: this.response.usage ?? null };
  }


}

function runner(analystProvider: ModelProvider, finalizerProvider: ModelProvider): TwoAgentHandoffRunner {
  return new TwoAgentHandoffRunner(new SingleAgent(analystProvider), new SingleAgent(finalizerProvider));
}

describe("TwoAgentHandoffRunner", () => {
  it("runs Analyst then Finalizer once, passing the original task and exact notes, and returns the final response", async () => {
    const analyst = new RecordingProvider({ type: "text", text: analystNotes });
    const finalizer = new RecordingProvider({ type: "text", text: "A thermostat regulates temperature around its set point." });

    const result = await runner(analyst, finalizer).run(task);

    expect(analyst.generateCount).toBe(1);
    expect(finalizer.generateCount).toBe(1);
    expect(analyst.prompts[0]).toContain(task);
    expect(finalizer.prompts[0]).toContain(`Original task:\n---\n${task}\n---`);
    expect(finalizer.prompts[0]).toContain(`Analyst context:\n---\n${analystNotes}\n---`);
    expect(result).toEqual({ type: "text", text: "A thermostat regulates temperature around its set point." });
    expect(analyst.continueCount + finalizer.continueCount).toBe(0);
  });

  it("keeps Fake providers separate, deterministic, and unwrapped", async () => {
    const analystFake = new FakeModelProvider([{ type: "text", text: analystNotes }]);
    const finalizerFake = new FakeModelProvider([{ type: "text", text: "Final answer from Fake." }]);

    expect(analystFake).not.toBe(finalizerFake);
    expect(analystFake).not.toBeInstanceOf(RetryingModelProvider);
    expect(finalizerFake).not.toBeInstanceOf(RetryingModelProvider);
    await expect(runner(analystFake, finalizerFake).run(task)).resolves.toEqual({
      type: "text",
      text: "Final answer from Fake.",
    });
  });

  it("does not run Finalizer when Analyst fails", async () => {
    const analyst = new RecordingProvider(new Error("private analyst error"));
    const finalizer = new RecordingProvider({ type: "text", text: "Should not run." });

    await expect(runner(analyst, finalizer).run(task)).rejects.toThrow("Agent handoff could not be completed.");
    expect(analyst.generateCount).toBe(1);
    expect(finalizer.generateCount).toBe(0);
  });

  it("does not run Finalizer when Analyst returns empty or whitespace-only text", async () => {
    for (const text of ["", " \n\t "]) {
      const analyst = new RecordingProvider({ type: "text", text });
      const finalizer = new RecordingProvider({ type: "text", text: "Should not run." });

      await expect(runner(analyst, finalizer).run(task)).rejects.toThrow("Agent handoff could not be completed.");
      expect(finalizer.generateCount).toBe(0);
    }
  });

  it("rejects an invalid handoff task before either agent runs", async () => {
    const analyst = new RecordingProvider({ type: "text", text: analystNotes });
    const finalizer = new RecordingProvider({ type: "text", text: "Should not run." });

    await expect(runner(analyst, finalizer).run("  ")).rejects.toThrow("Agent handoff could not be completed.");
    expect(analyst.generateCount).toBe(0);
    expect(finalizer.generateCount).toBe(0);
  });

  it("sanitizes Finalizer failure and does not return to Analyst", async () => {
    const analyst = new RecordingProvider({ type: "text", text: analystNotes });
    const finalizer = new RecordingProvider(new Error("private finalizer error"));

    await expect(runner(analyst, finalizer).run(task)).rejects.toThrow("Agent handoff could not be completed.");
    expect(analyst.generateCount).toBe(1);
    expect(finalizer.generateCount).toBe(1);
  });

  it("does not allow Finalizer to request a second handoff", async () => {
    const analyst = new RecordingProvider({ type: "text", text: analystNotes });
    const finalizer = new RecordingProvider({ type: "tool_call", call: { callId: "unsupported-handoff", toolName: "handoff", arguments: { expression: "Return to Analyst" } } });

    await expect(runner(analyst, finalizer).run(task)).rejects.toThrow("Agent handoff could not be completed.");
    expect(analyst.generateCount).toBe(1);
    expect(finalizer.generateCount).toBe(1);
    expect(analyst.prompts).toHaveLength(1);
  });

  describe("failure codes", () => {
    const failsWith = async (analyst: ModelProvider, finalizer: ModelProvider, input: string, failureCode: string) => {
      const failure = await runner(analyst, finalizer).run(input).then(() => undefined, (error: unknown) => error);

      expect(failure).toMatchObject({
        name: "AgentFailure",
        failureCode,
        message: "Agent handoff could not be completed.",
      });
      return failure as Error;
    };

    it("keeps the Analyst's failure category and hides provider details in the message", async () => {
      const analyst = new RecordingProvider(new Error("private analyst error"));
      const finalizer = new RecordingProvider({ type: "text", text: "Should not run." });

      const failure = await failsWith(analyst, finalizer, task, "provider_error");
      expect(failure.message).not.toContain("private");
    });

    it("keeps the Finalizer's failure category, such as an unavailable tool", async () => {
      const analyst = new RecordingProvider({ type: "text", text: analystNotes });
      const finalizer = new RecordingProvider({ type: "tool_call", call: { callId: "c1", toolName: "handoff", arguments: { expression: "x" } } });

      await failsWith(analyst, finalizer, task, "tool_unavailable");
    });

    it("reports invalid_handoff for empty Analyst notes and for an empty task", async () => {
      const emptyNotes = new RecordingProvider({ type: "text", text: " " });
      const finalizer = new RecordingProvider({ type: "text", text: "Should not run." });

      await failsWith(emptyNotes, finalizer, task, "invalid_handoff");
      await failsWith(new RecordingProvider({ type: "text", text: analystNotes }), finalizer, "  ", "invalid_handoff");
    });
  });
});
