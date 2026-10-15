import { describe, expect, it, vi, afterEach } from "vitest";
import { abortableDelay } from "./cancellation";
import { RetryingModelProvider } from "./providers/retrying-model-provider";
import { RetryableProviderError } from "./retryable-provider-error";
import { FakeModelProvider } from "./providers/fake-model-provider";
import { CalculatorTool } from "../tools/calculator-tool";
import { SingleAgent } from "./single-agent";
import { TwoAgentHandoffRunner } from "./two-agent-handoff-runner";
import { runExperiment } from "../experiments/run-experiment";
import type { ExperimentEvent } from "../experiments/types";

const text = { type: "text" as const, text: "Done", finishReason: "stop" as const, usage: null };
const task = "Explain and calculate";
afterEach(() => vi.useRealTimers());
describe("cancellation across the run", () => {
  it("clears delay timers and listeners on abort and completion", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const pending = abortableDelay(1000, controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ failureCode: "cancelled" });
    controller.abort("private reason"); await assertion;
    expect(vi.getTimerCount()).toBe(0); expect(remove).toHaveBeenCalledOnce();
    const second = new AbortController(); const removeSecond = vi.spyOn(second.signal, "removeEventListener");
    const finished = abortableDelay(50, second.signal); await vi.advanceTimersByTimeAsync(50); await finished;
    expect(removeSecond).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("stops in retry backoff with no later attempt", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const complete = vi.fn(async () => { throw new RetryableProviderError(); });
    const provider = new RetryingModelProvider({ complete });
    const pending = provider.complete({ messages: [{ role: "user", text: task }], tools: [], signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ failureCode: "cancelled" });
    await Promise.resolve(); controller.abort(); await assertion; await vi.runAllTimersAsync();
    expect(complete).toHaveBeenCalledOnce();
  });
  it("does no model/tool work for a pre-aborted run and emits one terminal failure", async () => {
    const controller = new AbortController(); controller.abort();
    const complete = vi.fn(async () => text);
    const events: ExperimentEvent[] = [];
    const experiment = await runExperiment(task, new SingleAgent({ complete }, [new CalculatorTool()]), (e) => events.push(e), { signal: controller.signal });
    expect(experiment).toMatchObject({ status: "failed", failureCode: "cancelled" });
    expect(complete).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toEqual(["experiment.started", "agent.started", "experiment.failed"]);
  });
  it.each([true, false])("does not accept a late tool result after abort (deterministic: %s)", async (deterministic) => {
    const controller = new AbortController();
    const calculator = new CalculatorTool();
    const execute = vi.fn(async (_input, options) => { expect(options.signal).toBe(controller.signal); controller.abort("private reason"); return "2"; });
    const agent = new SingleAgent(new FakeModelProvider([{ type: "tool_call", call: { callId: "one", toolName: "calculator", arguments: { expression: "1+1" } } }, text]),
      [{ definition: calculator.definition, validateInput: calculator.validateInput, execute }]);
    const events: ExperimentEvent[] = [];
    const experiment = await runExperiment(deterministic ? "1+1" : task, agent, (e) => events.push(e), { signal: controller.signal });
    expect(experiment).toMatchObject({ status: "failed", failureCode: "cancelled" });
    expect(events.filter((e) => e.type.startsWith("tool.")).map((e) => e.type)).toEqual(["tool.started", "tool.failed"]);
    expect(events.filter((e) => e.type === "model.requested")).toHaveLength(deterministic ? 0 : 1);
    expect(JSON.stringify(events)).not.toContain("private reason");
  });
  it("does not accept a late model result or retry it after abort", async () => {
    const controller = new AbortController();
    const complete = vi.fn(async () => { controller.abort(); return text; });
    const events: ExperimentEvent[] = [];
    const experiment = await runExperiment(task, new SingleAgent(new RetryingModelProvider({ complete })), (e) => events.push(e), { signal: controller.signal });
    expect(experiment.failureCode).toBe("cancelled"); expect(complete).toHaveBeenCalledOnce();
    expect(events.filter((e) => e.type === "model.responded")).toEqual([expect.objectContaining({ outcome: "error" })]);
    expect(events.some((e) => e.type === "experiment.completed")).toBe(false);
  });
  it("does not begin Finalizer after cancellation at the handoff boundary", async () => {
    const controller = new AbortController();
    const finalizer = vi.fn(async () => text);
    const runner = new TwoAgentHandoffRunner(new SingleAgent(new FakeModelProvider([text])), new SingleAgent({ complete: finalizer }));
    const events: ExperimentEvent[] = [];
    const experiment = await runExperiment(task, runner, (e) => {
      events.push(e); if (e.type === "handoff.completed") controller.abort();
    }, { signal: controller.signal });
    expect(experiment.failureCode).toBe("cancelled"); expect(finalizer).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === "handoff.failed")).toBe(false);
  });
  it("keeps an already completed terminal result when the consumer aborts afterward", async () => {
    const controller = new AbortController(); const events: ExperimentEvent[] = [];
    const result = await runExperiment(task, new SingleAgent(new FakeModelProvider([text])), (e) => {
      events.push(e); if (e.type === "experiment.completed") controller.abort();
    }, { signal: controller.signal });
    expect(result.status).toBe("completed"); expect(events.filter((e) => e.type === "experiment.failed")).toHaveLength(0);
  });
});
