import { describe, expect, it, vi } from "vitest";
import type { ModelProvider, ModelResponse, CompleteRequest } from "./model-provider";
import { FakeModelProvider, type FakeResponse } from "./providers/fake-model-provider";
import { RetryingModelProvider } from "./providers/retrying-model-provider";
import { RetryableProviderError } from "./retryable-provider-error";
import { SingleAgent, STRUCTURED_AGENT_INSTRUCTION, type ModelCallSignal, type ToolLifecycleSignal } from "./single-agent";
import { CalculatorTool } from "../tools/calculator-tool";
import type { Tool } from "../tools/tool";

const text = (value = "Done."): ModelResponse => ({ type: "text", text: value, finishReason: "stop", usage: null });
const call = (id = "one", name = "calculator", expression = "12 * 8"): ModelResponse => ({
  type: "tool_call", call: { callId: id, toolName: name, arguments: { expression } }, finishReason: "tool_call", usage: null,
});
const calculator = () => new CalculatorTool();
const scripted = (responses: FakeResponse[]) => new FakeModelProvider(responses);

describe("SingleAgent stateless loop", () => {
  it.each(["12 * 8", "(18 - 6) / 3", "-2 + 3", "1.5 * 2"])("skips the model for arithmetic: %s", async (task) => {
    const complete = vi.fn(async () => text());
    const signals: ModelCallSignal[] = [];
    const lifecycle: ToolLifecycleSignal[] = [];
    const agent = new SingleAgent({ complete }, [calculator()]);
    const expected = await calculator().execute({ expression: task }, {});
    await expect(agent.run(task, (s) => lifecycle.push(s), (s) => signals.push(s))).resolves.toEqual({ type: "text", text: expected });
    expect(complete).not.toHaveBeenCalled();
    expect(signals).toEqual([{ type: "model.skipped", reason: "deterministic_arithmetic" }]);
    expect(lifecycle.map((s) => s.type)).toEqual(["tool.started", "tool.completed"]);
  });
  it.each(["Write about Istanbul.", "2026 yılında İstanbul", "2 + "])("uses the model for non-arithmetic: %s", async (task) => {
    const complete = vi.fn(async () => text("Answer"));
    await expect(new SingleAgent({ complete }, [calculator()]).run(task)).resolves.toEqual({ type: "text", text: "Answer" });
    expect(complete.mock.calls[0]).toEqual([{ messages: [{ role: "user", text: task }], tools: [calculator().definition] }]);
  });
  it("keeps the locked prompt experiment and fresh conversations for repeat runs", async () => {
    const requests: CompleteRequest[] = [];
    const provider: ModelProvider = { complete: async (r) => { requests.push(r); return text(); } };
    const baseline = new SingleAgent(provider);
    await baseline.run("Task"); await baseline.run("Task");
    await new SingleAgent(provider, [], "structured").run("Task");
    expect(requests.map((r) => r.messages)).toEqual([
      [{ role: "user", text: "Task" }], [{ role: "user", text: "Task" }],
      [{ role: "user", text: `Task\n\n${STRUCTURED_AGENT_INSTRUCTION}` }],
    ]);
  });
  it("owns the full transcript, keeps assistant text, and does not mutate earlier requests", async () => {
    const responses = [ { ...call(), text: "Let me calculate." }, text("96") ];
    const requests: CompleteRequest[] = [];
    const provider: ModelProvider = { complete: async (r) => { requests.push(r); return responses[requests.length - 1]; } };
    await new SingleAgent(provider, [calculator()]).run("Calculate and explain");
    expect(requests[0].messages).toHaveLength(1);
    expect(requests[1].messages).toEqual([
      { role: "user", text: "Calculate and explain" },
      { role: "assistant", type: "tool_call", call: (responses[0] as Extract<ModelResponse, { type: "tool_call" }>).call, text: "Let me calculate." },
      { role: "tool", callId: "one", toolName: "calculator", output: "96" },
    ]);
    expect(requests[0].tools[0]).not.toHaveProperty("execute");
  });
  it("retries the same continuation without executing the tool again", async () => {
    const execute = vi.fn(async () => "96");
    const tool: Tool = { definition: calculator().definition, validateInput: calculator().validateInput, execute };
    const complete = vi.fn().mockResolvedValueOnce(call()).mockRejectedValueOnce(new RetryableProviderError()).mockResolvedValueOnce(text("96"));
    const provider = new RetryingModelProvider({ complete }, { sleep: async () => {}, random: () => 0 });
    await new SingleAgent(provider, [tool]).run("Use the calculator");
    expect(execute).toHaveBeenCalledOnce();
    expect(complete.mock.calls[1][0]).toEqual(complete.mock.calls[2][0]);
  });
  it("executes three tools and sends the third result before rejecting a fourth", async () => {
    const tool = calculator(); const execute = vi.spyOn(tool, "execute");
    const provider = scripted([call("1"), call("2"), call("3"), call("4")]);
    const complete = vi.spyOn(provider, "complete");
    await expect(new SingleAgent(provider, [tool]).run("Calculate repeatedly")).rejects.toMatchObject({ failureCode: "tool_limit" });
    expect(execute).toHaveBeenCalledTimes(3);
    expect(complete.mock.calls.at(-1)?.[0].messages.at(-1)).toEqual({ role: "tool", callId: "3", toolName: "calculator", output: "96" });
  });
  it.each([
    [call("one", "missing"), "tool_unavailable"],
    [call(" "), "invalid_tool_call"],
    [{ ...call(), call: { callId: "one", toolName: "calculator", arguments: { expression: 3 } } }, "invalid_tool_call"],
    [{ ...call(), call: { callId: "one", toolName: "calculator", arguments: { expression: "1+1", extra: true } } }, "invalid_tool_call"],
  ] as const)("rejects invalid or unavailable tools before execution", async (response, failureCode) => {
    const tool = calculator(); const execute = vi.spyOn(tool, "execute");
    await expect(new SingleAgent(scripted([response]), [tool]).run("Use a tool")).rejects.toMatchObject({ failureCode });
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects a reused call id before a second execution", async () => {
    const tool = calculator(); const execute = vi.spyOn(tool, "execute");
    await expect(new SingleAgent(scripted([call(), call()]), [tool]).run("Use a tool")).rejects.toMatchObject({ failureCode: "invalid_tool_call" });
    expect(execute).toHaveBeenCalledOnce();
  });
  it.each([true, false])("keeps safe tool failure semantics in deterministic and model paths: %s", async (deterministic) => {
    const events: ToolLifecycleSignal[] = [];
    const agent = new SingleAgent(scripted([call("one", "calculator", "5/0")]), [calculator()]);
    await expect(agent.run(deterministic ? "5/0" : "Use the tool", (s) => events.push(s))).rejects.toMatchObject({ failureCode: "tool_failed", cause: expect.any(Error) });
    expect(events.map((s) => s.type)).toEqual(["tool.started", "tool.failed"]);
    expect(JSON.stringify(events)).not.toContain("Division by zero");
  });
  it.each([0, 1])("classifies initial/continuation provider errors safely: %s", async (afterTool) => {
    const complete = vi.fn().mockRejectedValue(new Error("private provider detail"));
    if (afterTool) complete.mockResolvedValueOnce(call());
    const signals: ModelCallSignal[] = [];
    await expect(new SingleAgent({ complete }, [calculator()]).run("Use model", undefined, (s) => signals.push(s)))
      .rejects.toMatchObject({ failureCode: "provider_error" });
    expect(signals.at(-1)).toMatchObject({ type: "model.responded", outcome: "error" });
    expect(JSON.stringify(signals)).not.toContain("private provider detail");
  });
  it("keeps secrets out of model signals while preserving call purposes", async () => {
    const signals: ModelCallSignal[] = [];
    await new SingleAgent(scripted([call("private-id", "calculator", "7*6"), text("private output")]), [calculator()])
      .run("private task", undefined, (s) => signals.push(s));
    expect(signals.filter((s) => s.type === "model.requested").map((s) => s.purpose)).toEqual(["initial", "after_tool"]);
    for (const secret of ["private-id", "private output", "private task", "7*6"]) expect(JSON.stringify(signals)).not.toContain(secret);
  });
  it("does not classify callback bugs as provider errors", async () => {
    await expect(new SingleAgent(scripted([text()])).run("Task", undefined, (s) => { if (s.type === "model.responded") throw new Error("callback bug"); })).rejects.toThrow("callback bug");
  });
  it.each(["length", "content_filter", "refusal"] as const)("does not complete truncated or refused text: %s", async (finishReason) => {
    await expect(new SingleAgent(scripted([{ ...text(), finishReason }])).run("Task")).rejects.toMatchObject({ failureCode: "provider_error" });
  });
  it("accepts explicitly unknown finish reason without leaking metadata into output", async () => {
    await expect(new SingleAgent(scripted([{ ...text(), finishReason: "unknown", usage: { inputTokens: 1, outputTokens: 2, totalTokens: null } }])).run("Task"))
      .resolves.toEqual({ type: "text", text: "Done." });
  });
});
