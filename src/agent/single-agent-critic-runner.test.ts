import { describe, expect, it, vi } from "vitest";
import { SingleAgentCriticRunner } from "./single-agent-critic-runner";
import { FakeModelProvider, type FakeResponse } from "./providers/fake-model-provider";
import { SingleAgent } from "./single-agent";
import { AgentFailure } from "./agent-failure";
import { abortableDelay } from "./cancellation";
import { MAX_EVIDENCE_BYTES, type AuditProgress } from "./critic-report";
import { SCENARIOS } from "../experiments/scenarios";
import { runExperiment } from "../experiments/run-experiment";
import type { ExperimentEvent } from "../experiments/types";
import { createTools } from "../tools/tool-registry";
import { DOCUMENT_CORPUS } from "../tools/document-search-corpus";
import { DocumentSearchTool } from "../tools/document-search-tool";
import type { ModelProvider, CompleteRequest } from "./model-provider";
import type { Tool } from "../tools/tool";

const text = (value: string) => ({ type: "text" as const, text: value, finishReason: "stop" as const, usage: null });
const audit = (value = '{"verdict":"no_issue","issues":[]}') => new FakeModelProvider([{ type: "text", text: value }]);
const payload = (request: CompleteRequest) => {
  const message = request.messages[1];
  if (!("text" in message)) throw new Error("Expected audit data message.");
  return JSON.parse(message.text!);
};

describe("audit-only runner", () => {
  it("requires separate producer and Critic instances", () => {
    const provider = audit();
    expect(() => new SingleAgentCriticRunner(provider, provider, [])).toThrow("independent providers");
  });
  for (const scenario of [SCENARIOS[5], SCENARIOS[6], SCENARIOS[7]]) for (const verdict of ["no_issue", "issues_found", "insufficient_evidence"] as const) {
    it(`${scenario.id}/${verdict}: keeps baseline output and evaluator independent`, async () => {
      const responses = scenario.fakeByKind.single.primary;
      const producer = new FakeModelProvider(responses);
      const complete = vi.spyOn(producer, "complete");
      const critic = audit(JSON.stringify({ verdict, issues: verdict === "no_issue" ? [] : [{ kind: "evidence_gap", message: "Possible gap", evidenceId: 1 }] }));
      const inspect = vi.spyOn(critic, "complete");
      const progress: AuditProgress[] = [];
      const events: ExperimentEvent[] = [];
      const tools = createTools(scenario.toolIds);
      const executions = tools.map((tool) => vi.spyOn(tool, "execute"));
      const result = await runExperiment(scenario.task, new SingleAgentCriticRunner(producer, critic, tools, (p) => progress.push(p)), (e) => events.push(e));
      const baseline = await new SingleAgent(new FakeModelProvider(responses), createTools(scenario.toolIds)).run(scenario.task);
      expect(result.output).toEqual(baseline);
      expect(scenario.evaluate?.(result, events)?.passed).toBe(true);
      expect(inspect).toHaveBeenCalledOnce();
      expect(inspect.mock.calls[0][0].tools).toEqual([]);
      expect(complete.mock.calls[0][0].messages).toEqual([{ role: "user", text: scenario.task }]);
      const data = payload(inspect.mock.calls[0][0]);
      expect(data.task).toBe(scenario.task); expect(data.producerAnswer).toBe(baseline.text);
      expect(data.evidence.map((e: { id: number }) => e.id)).toEqual(data.evidence.map((_: unknown, i: number) => i + 1));
      expect(data.evidence).toHaveLength(events.filter((e) => e.type === "tool.completed").length);
      expect(executions.reduce((sum, execute) => sum + execute.mock.calls.length, 0)).toBe(data.evidence.length);
      expect(progress.at(-1)?.report?.verdict).toBe(verdict);
      expect(events.filter((e) => e.type === "model.requested").length).toBeLessThanOrEqual(5);
      expect(JSON.stringify(events)).not.toContain('"evidenceId"');
    });
  }

  it.each([
    [{ type: "text", text: "bad report" }, "unknown", "invalid_report"],
    [{ type: "tool_call", call: { callId: "audit-tool", toolName: "calculator", arguments: { expression: "1+1" } } }, "tool_unavailable", "tool_unavailable"],
    [{ type: "text", text: '{"verdict":"no_issue","issues":[]}', finishReason: "length" }, "provider_error", "provider_error"],
  ] as const)("fails a bad audit without repair %#", async (response, failureCode, status) => {
    const critic = new FakeModelProvider([response]); const call = vi.spyOn(critic, "complete");
    const progress: AuditProgress[] = [];
    await expect(new SingleAgentCriticRunner(new FakeModelProvider([{ type: "text", text: "Original" }]), critic, [], (p) => progress.push(p)).run("Explain"))
      .rejects.toMatchObject({ failureCode });
    expect(call).toHaveBeenCalledOnce(); expect(progress.at(-1)?.status).toBe(status);
    expect(progress.at(-1)?.report).toBeUndefined();
  });

  it.each(["provider_error", "invalid_tool_call"] as const)("keeps safe audit %s", async (failureCode) => {
    const critic: ModelProvider = { complete: vi.fn(async () => { throw new AgentFailure(failureCode, { message: "private provider" }); }) };
    const progress: AuditProgress[] = [];
    await expect(new SingleAgentCriticRunner(audit("Original"), critic, [], (p) => progress.push(p)).run("Explain"))
      .rejects.toMatchObject({ failureCode });
    expect(JSON.stringify(progress)).not.toContain("private provider");
  });

  it("does not start Critic on producer or tool failure", async () => {
    const critic = audit(); const complete = vi.spyOn(critic, "complete");
    const cases: readonly FakeResponse[][] = [[{ type: "tool_call", call: { callId: "x", toolName: "missing", arguments: {} } }],
      [{ type: "tool_call", call: { callId: "x", toolName: "calculator", arguments: { expression: "1/0" } } }]];
    for (const responses of cases) await expect(new SingleAgentCriticRunner(new FakeModelProvider(responses), critic, createTools(["calculator"])).run("Explain"))
      .rejects.toBeInstanceOf(AgentFailure);
    expect(complete).not.toHaveBeenCalled();
  });

  it.each(["producer", "critic"] as const)("cancels while %s is pending without later calls", async (phase) => {
    const controller = new AbortController();
    const pending = { complete: vi.fn(async (r: CompleteRequest) => { controller.abort(); await abortableDelay(60000, r.signal); return text("late"); }) };
    const other = audit("Original"); const otherCall = vi.spyOn(other, "complete");
    const progress: AuditProgress[] = [];
    const runner = new SingleAgentCriticRunner(phase === "producer" ? pending : other, phase === "critic" ? pending : other, [], (p) => progress.push(p));
    await expect(runner.run("Explain", undefined, undefined, { signal: controller.signal })).rejects.toMatchObject({ failureCode: "cancelled" });
    expect(pending.complete).toHaveBeenCalledOnce();
    expect(otherCall).toHaveBeenCalledTimes(phase === "producer" ? 0 : 1);
    expect(progress.at(-1)?.status).toBe("cancelled");
  });

  it("does no work for pre-abort or abort at the producer/audit boundary", async () => {
    const controller = new AbortController(); const producer = audit("Original"); const critic = audit();
    const first = vi.spyOn(producer, "complete"); const second = vi.spyOn(critic, "complete"); controller.abort();
    await expect(new SingleAgentCriticRunner(producer, critic, []).run("Explain", undefined, undefined, { signal: controller.signal }))
      .rejects.toMatchObject({ failureCode: "cancelled" });
    expect(first).not.toHaveBeenCalled(); expect(second).not.toHaveBeenCalled();
    const boundary = new AbortController();
    await expect(new SingleAgentCriticRunner(producer, critic, [], (p) => { if (p.phase === "critic") boundary.abort(); })
      .run("Explain", undefined, undefined, { signal: boundary.signal })).rejects.toMatchObject({ failureCode: "cancelled" });
    expect(second).not.toHaveBeenCalled();
  });

  it("keeps evidence isolated across reuse and excludes raw data from events", async () => {
    const secret = "LONG_PRIVATE_TOOL_RESULT_SENTINEL";
    const definition = new DocumentSearchTool().definition;
    const tool: Tool = { definition, validateInput: () => true, execute: async () => secret };
    const producer = new FakeModelProvider([{ type: "tool_call", call: { callId: "a", toolName: "document_search", arguments: { query: "PRIVATE_QUERY_SENTINEL" } } }, { type: "text", text: "Original" }]);
    const requests: CompleteRequest[] = [];
    const critic = { complete: vi.fn(async (r: CompleteRequest) => { requests.push(r); return text('{"verdict":"no_issue","issues":[]}'); }) };
    const runner = new SingleAgentCriticRunner(producer, critic, [tool]);
    for (let i = 0; i < 2; i++) {
      const events: ExperimentEvent[] = [];
      await runExperiment("Explain", runner, (e) => events.push(e));
      expect(JSON.stringify(events)).not.toMatch(/LONG_PRIVATE_TOOL_RESULT_SENTINEL|PRIVATE_QUERY_SENTINEL/);
    }
    expect(requests.map((r) => payload(r).evidence.length)).toEqual([1, 1]);
  });

  it("fails evidence overflow without truncating or asking Critic", async () => {
    const critic = audit(); const complete = vi.spyOn(critic, "complete");
    const tool: Tool = { definition: new DocumentSearchTool().definition, validateInput: () => true, execute: async () => "a".repeat(MAX_EVIDENCE_BYTES) };
    const producer = new FakeModelProvider([{ type: "tool_call", call: { callId: "a", toolName: "document_search", arguments: { query: "x" } } }, { type: "text", text: "Original" }]);
    await expect(new SingleAgentCriticRunner(producer, critic, [tool]).run("Explain")).rejects.toMatchObject({ failureCode: "unknown" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("fits the actual fixed-corpus maximum within the evidence bound", () => {
    const largestDocuments = [...DOCUMENT_CORPUS].sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length).slice(0, 3);
    const output = JSON.stringify({ results: largestDocuments, totalMatches: DOCUMENT_CORPUS.length, truncated: true });
    const evidence = [1, 2, 3].map((id) => ({ id, toolName: "document_search", input: { query: "x".repeat(120) }, output }));
    expect(new TextEncoder().encode(JSON.stringify(evidence)).byteLength).toBeLessThan(MAX_EVIDENCE_BYTES);
  });
});
