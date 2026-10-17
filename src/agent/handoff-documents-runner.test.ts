import { expect, it, vi } from "vitest";
import { HandoffDocumentsRunner } from "./handoff-documents-runner";
import { FakeModelProvider, type FakeResponse } from "./providers/fake-model-provider";
import { createTools } from "../tools/tool-registry";
import { SCENARIOS } from "../experiments/scenarios";
import { runExperiment } from "../experiments/run-experiment";
import type { CompleteRequest } from "./model-provider";
import type { ExperimentEvent } from "../experiments/types";
import { abortableDelay } from "./cancellation";

const scenario = SCENARIOS[7];
const responses = scenario.fakeByKind.single.primary;
const final = responses.at(-1)!;
it("uses fresh conversations on reuse, three real tools and only task plus notes for Finalizer", async () => {
  const requests: { slot: string; request: CompleteRequest }[] = [];
  const provider = (slot: string, script: readonly FakeResponse[]) => {
    const fake = new FakeModelProvider(script);
    return { complete: async (request: CompleteRequest) => { requests.push({ slot, request }); return fake.complete(request); } };
  };
  const runner = new HandoffDocumentsRunner(provider("analyst", responses), provider("finalizer", [final]), createTools(scenario.toolIds));
  for (let i = 0; i < 2; i += 1) {
    const events: ExperimentEvent[] = [];
    const experiment = await runExperiment(scenario.task, runner, (e) => events.push(e));
    expect(experiment.status).toBe("completed");
    expect(events.filter((e) => e.type === "tool.completed").map((e) => e.agentId)).toEqual(["analyst", "analyst", "analyst"]);
    expect(events.filter((e) => e.type === "model.requested")).toHaveLength(5);
    const request = requests.at(-1)!.request;
    expect(request.tools).toEqual([]);
    expect(request.messages).toHaveLength(1);
    expect(request.messages[0]).toMatchObject({ role: "user", text: expect.stringContaining(scenario.task) });
    expect(JSON.stringify(request.messages)).toContain((final as { text: string }).text);
    expect(JSON.stringify(request.messages)).not.toContain('"role":"tool"');
  }
  expect(requests.filter((r) => r.slot === "analyst")).toHaveLength(8);
});

it.each(["", "  ", "é".repeat(4097)])("rejects empty/oversize UTF-8 notes before handoff: %s", async (text) => {
  const finalizer = { complete: vi.fn() };
  const events: ExperimentEvent[] = [];
  const experiment = await runExperiment("Task", new HandoffDocumentsRunner(new FakeModelProvider([{ type: "text", text }]), finalizer, []), (e) => events.push(e));
  expect(experiment.failureCode).toBe("invalid_handoff");
  expect(finalizer.complete).not.toHaveBeenCalled();
  expect(events.filter((e) => e.type === "handoff.failed")).toHaveLength(1);
});

it("accepts the exact byte limit without truncation", async () => {
  const text = "é".repeat(4096);
  const complete = vi.fn(async (request: CompleteRequest) => {
    expect(JSON.stringify(request.messages)).toContain(text);
    return { type: "text" as const, text: "Final", finishReason: "stop" as const, usage: null };
  });
  await expect(new HandoffDocumentsRunner(new FakeModelProvider([{ type: "text", text }]), { complete }, []).run("Task")).resolves.toEqual({ type: "text", text: "Final" });
  expect(complete).toHaveBeenCalledOnce();
});

it("rejects Finalizer tool requests without executing any tool", async () => {
  const tool = createTools(["calculator"])[0]; const execute = vi.spyOn(tool, "execute");
  const runner = new HandoffDocumentsRunner(new FakeModelProvider([{ type: "text", text: "Notes" }]),
    new FakeModelProvider([{ type: "tool_call", call: { callId: "bad", toolName: "calculator", arguments: { expression: "1+1" } } }]), [tool]);
  await expect(runner.run("Task")).rejects.toMatchObject({ failureCode: "tool_unavailable" });
  expect(execute).not.toHaveBeenCalled();
});

it("rejects Analyst's fourth tool before execution and never starts Finalizer", async () => {
  const finalizer = { complete: vi.fn() };
  const tool = createTools(["calculator"])[0]; const execute = vi.spyOn(tool, "execute");
  const script: FakeResponse[] = [1, 2, 3, 4].map((i) => ({ type: "tool_call", call: { callId: `call-${i}`, toolName: "calculator", arguments: { expression: "1+1" } } }));
  await expect(new HandoffDocumentsRunner(new FakeModelProvider(script), finalizer, [tool]).run("Task")).rejects.toMatchObject({ failureCode: "tool_limit" });
  expect(execute).toHaveBeenCalledTimes(3); expect(finalizer.complete).not.toHaveBeenCalled();
});

it.each(["before", "analyst", "handoff", "finalizer"])("cancels at %s without starting another role", async (boundary) => {
  const controller = new AbortController();
  const providers = ["analyst", "finalizer"].map((slot) => ({ complete: vi.fn(async (request: CompleteRequest) => {
    if (slot === boundary) { controller.abort(); await abortableDelay(1000, request.signal); }
    return { type: "text" as const, text: "Notes", finishReason: "stop" as const, usage: null };
  }) }));
  if (boundary === "before") controller.abort();
  const events: ExperimentEvent[] = [];
  const experiment = await runExperiment("Task", new HandoffDocumentsRunner(providers[0], providers[1], []), (e) => {
    events.push(e); if (boundary === "handoff" && e.type === "handoff.completed") controller.abort();
  }, { signal: controller.signal });
  expect(experiment.failureCode).toBe("cancelled");
  expect(events.filter((e) => e.type === "experiment.failed")).toHaveLength(1);
  if (boundary !== "finalizer") expect(providers[1].complete).not.toHaveBeenCalled();
});

it("requires independent providers", () => {
  const provider = new FakeModelProvider();
  expect(() => new HandoffDocumentsRunner(provider, provider, [])).toThrow();
});
