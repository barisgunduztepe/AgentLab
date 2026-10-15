import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { describe, expect, it } from "vitest";
import { OpenAIModelProvider } from "./openai-model-provider";
import { GeminiModelProvider } from "./gemini-model-provider";
import { FakeModelProvider, type FakeResponse } from "./fake-model-provider";
import { RetryingModelProvider } from "./retrying-model-provider";
import type { CompleteRequest, ModelMessage, ModelProvider } from "../model-provider";
import { CalculatorTool } from "../../tools/calculator-tool";

const kinds = ["fake", "openai", "gemini"] as const;
type Kind = (typeof kinds)[number];
const text: FakeResponse = { type: "text", text: "Done." };
const call = { callId: "one", toolName: "lookup", arguments: { query: "subject" } };
const tool = { ...new CalculatorTool().definition, name: "lookup", parameters: {
  type: "object" as const, properties: { query: { type: "string" as const } }, required: ["query"], additionalProperties: false as const,
} };
const initial = (task = "Task"): CompleteRequest => ({ messages: [{ role: "system", text: "System" }, { role: "user", text: task }], tools: [tool] });
const next = (): CompleteRequest => ({ ...initial(), messages: [...initial().messages,
  { role: "assistant", type: "tool_call", call, text: "Looking up." },
  { role: "tool", callId: "one", toolName: "lookup", output: "Found" }] });

function rawResponse(kind: Kind, response: FakeResponse): object {
  const usage = response.usage;
  if (kind === "openai") return {
    object: "response", id: "response", status: "completed",
    output: response.type === "tool_call" ? [
      ...(response.text ? [{ type: "message", role: "assistant", content: [{ type: "output_text", text: response.text }] }] : []),
      { type: "function_call", call_id: response.call.callId, name: response.call.toolName, arguments: JSON.stringify(response.call.arguments) },
    ] : [{ type: "message", role: "assistant", content: [{ type: "output_text", text: response.text }] }],
    ...(usage ? { usage: { input_tokens: usage.inputTokens ?? undefined, output_tokens: usage.outputTokens ?? undefined, total_tokens: usage.totalTokens ?? undefined } } : {}),
  };
  return { id: "interaction", status: response.type === "tool_call" ? "requires_action" : "completed",
    steps: response.type === "tool_call" ? [
      ...(response.text ? [{ type: "model_output", content: [{ type: "text", text: response.text }] }] : []),
      { type: "function_call", id: response.call.callId, name: response.call.toolName, arguments: response.call.arguments },
    ] : [{ type: "model_output", content: [{ type: "text", text: response.text }] }],
    ...(usage ? { usage: { total_input_tokens: usage.inputTokens ?? undefined, total_output_tokens: usage.outputTokens ?? undefined, total_tokens: usage.totalTokens ?? undefined } } : {}),
  };
}

function harness(kind: Kind, responses: FakeResponse[], wrapped: boolean, transform: (raw: object) => object = (raw) => raw, hold = false) {
  const bodies: Record<string, unknown>[] = [];
  const signals: (AbortSignal | null)[] = [];
  let started!: () => void;
  const fetchStarted = new Promise<void>((resolve) => { started = resolve; });
  const fetcher: typeof fetch = async (url, init) => {
    const request = new Request(url, init);
    signals.push(request.signal);
    started();
    if (hold) return await new Promise<Response>((_resolve, reject) => {
      const abort = () => { request.signal.removeEventListener("abort", abort); reject(new DOMException("Aborted", "AbortError")); };
      request.signal.addEventListener("abort", abort, { once: true });
      if (request.signal.aborted) abort();
    });
    const body = await request.json() as Record<string, unknown>;
    bodies.push(body);
    const input = body.input as { type?: string }[];
    const turn = input.filter((item) => ["function_call_output", "function_result"].includes(item.type ?? "")).length;
    return Response.json(transform(rawResponse(kind, responses[turn] ?? text)));
  };
  const config = { apiKey: "test-only-key", model: "test-model" };
  let provider: ModelProvider = kind === "fake" ? new FakeModelProvider(responses) : kind === "openai"
    ? new OpenAIModelProvider(config, new OpenAI({ ...config, maxRetries: 0, fetch: fetcher }))
    : new GeminiModelProvider(config, new GoogleGenAI({ apiKey: config.apiKey, httpOptions: { fetch: fetcher } }));
  if (wrapped) provider = new RetryingModelProvider(provider, { sleep: async () => {}, random: () => 0 });
  return { provider, bodies, signals, fetchStarted };
}

for (const kind of kinds) for (const wrapped of [false, true]) describe(`${kind}${wrapped ? " + retry" : ""} shared contract`, () => {
  it("maps text and unknown usage without changing the request", async () => {
    const { provider } = harness(kind, [text], wrapped);
    const request = initial(); const original = structuredClone(request);
    await expect(provider.complete(request)).resolves.toEqual({ ...text, finishReason: "stop", usage: null });
    expect(request).toEqual(original);
  });
  it("maps a generic tool and replays the complete transcript without hidden conversation IDs", async () => {
    const { provider, bodies } = harness(kind, [{ type: "tool_call", call, text: "Looking up." }, text], wrapped);
    await expect(provider.complete(initial())).resolves.toEqual({ type: "tool_call", call, text: "Looking up.", finishReason: "tool_call", usage: null });
    await expect(provider.complete(next())).resolves.toMatchObject({ type: "text", text: "Done." });
    if (kind !== "fake") {
      expect(bodies).toHaveLength(2);
      for (const body of bodies) {
        expect(body).not.toHaveProperty("previous_response_id"); expect(body).not.toHaveProperty("previous_interaction_id");
        expect(body.store).toBe(false);
        expect(body.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: "lookup", parameters: tool.parameters })]));
      }
      const input = bodies[1].input as object[];
      expect(input).toEqual(expect.arrayContaining([expect.objectContaining({ type: "function_call", name: "lookup" })]));
      expect(JSON.stringify(input)).toContain(kind === "openai" ? "System" : "Task");
      expect(JSON.stringify(input)).toContain("Looking up."); expect(JSON.stringify(input)).toContain("Found");
      if (kind === "gemini") expect(bodies[1].system_instruction).toBe("System");
    }
  });
  it("isolates interleaved and concurrent calls on one instance", async () => {
    const { provider } = harness(kind, [text], wrapped);
    const a = await provider.complete(initial("A")); await provider.complete(initial("B"));
    expect(await provider.complete(initial("A"))).toEqual(a);
    expect(await Promise.all([provider.complete(initial("C")), provider.complete(initial("D"))])).toEqual([a, a]);
  });
  it.each([
    { inputTokens: 0, outputTokens: 2, totalTokens: null },
    { inputTokens: 3, outputTokens: 4, totalTokens: 10 },
  ])("preserves reported partial and total usage: %j", async (usage) => {
    await expect(harness(kind, [{ ...text, usage }], wrapped).provider.complete(initial())).resolves.toMatchObject({ usage });
  });
  it("lets the agent decide whether a returned tool is registered", async () => {
    const unknown = { ...call, toolName: "unregistered" };
    await expect(harness(kind, [{ type: "tool_call", call: unknown }], wrapped).provider.complete(initial())).resolves.toMatchObject({ call: unknown });
  });
  it.each(([[], [initial().messages[1], { role: "system", text: "late" }], [...initial().messages, { role: "assistant", type: "tool_call", call }]] as ModelMessage[][]).map((messages) => ({ messages })))
    ("rejects invalid message sequences without sending requests", async ({ messages }) => {
      const { provider, bodies } = harness(kind, [text], wrapped);
      await expect(provider.complete({ messages, tools: [] })).rejects.toThrow(); expect(bodies).toHaveLength(0);
    });
  it("rejects a pre-aborted request without touching transport", async () => {
    const { provider, bodies } = harness(kind, [text], wrapped);
    const controller = new AbortController(); controller.abort("private cancellation reason");
    await expect(provider.complete({ ...initial(), signal: controller.signal })).rejects.toMatchObject({ failureCode: "cancelled" });
    expect(bodies).toHaveLength(0);
  });
  if (kind !== "fake") it("propagates cancellation through the real SDK into fetch", async () => {
    const h = harness(kind, [text], wrapped, (raw) => raw, true);
    const controller = new AbortController();
    const pending = h.provider.complete({ ...initial(), signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ failureCode: "cancelled" });
    await h.fetchStarted;
    controller.abort("private cancellation reason");
    await rejected;
    expect(h.signals).toHaveLength(1); expect(h.signals[0]?.aborted).toBe(true);
  });
  it("rejects invalid tool argument envelopes", async () => {
    const invalid = { ...call, arguments: [] } as unknown as typeof call;
    await expect(harness(kind, [{ type: "tool_call", call: invalid }], wrapped).provider.complete(initial())).rejects.toMatchObject({ failureCode: "invalid_tool_call" });
  });
  it("rejects invalid usage instead of converting it to zero", async () => {
    await expect(harness(kind, [{ ...text, usage: { inputTokens: -1, outputTokens: 2, totalTokens: 1 } }], wrapped).provider.complete(initial())).rejects.toThrow();
  });
});

for (const kind of ["openai", "gemini"] as const) describe(`${kind} native protocol guards`, () => {
  it("rejects multiple native calls", async () => {
    const h = harness(kind, [{ type: "tool_call", call }], false, (raw) => {
      const r = raw as Record<string, unknown>;
      const key = kind === "openai" ? "output" : "steps";
      const calls = r[key] as object[]; return { ...r, [key]: [...calls, ...calls] };
    });
    await expect(h.provider.complete(initial())).rejects.toMatchObject({ failureCode: "invalid_tool_call" });
  });
  it.each(["failed", "queued", "incomplete"])("does not accept incomplete native status: %s", async (status) => {
    const h = harness(kind, [text], false, (raw) => ({ ...raw, status }));
    await expect(h.provider.complete(initial())).rejects.toThrow();
  });
});
describe("OpenAI native finish reasons", () => {
  it.each([["max_output_tokens", "length"], ["content_filter", "content_filter"]])("maps %s without discarding usage", async (reason, finishReason) => {
    const h = harness("openai", [text], false, (raw) => ({ ...raw, status: "incomplete", incomplete_details: { reason } }));
    await expect(h.provider.complete(initial())).resolves.toMatchObject({ type: "text", finishReason });
  });
  it("rejects invalid JSON arguments", async () => {
    const h = harness("openai", [{ type: "tool_call", call }], false, (raw) => ({ ...raw,
      output: [{ type: "function_call", call_id: "one", name: "lookup", arguments: "not-json" }] }));
    await expect(h.provider.complete(initial())).rejects.toMatchObject({ failureCode: "invalid_tool_call" });
  });
  it("maps an explicit refusal", async () => {
    const h = harness("openai", [text], false, (raw) => ({ ...raw,
      output: [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "Cannot comply" }] }] }));
    await expect(h.provider.complete(initial())).resolves.toMatchObject({ finishReason: "refusal" });
  });
});
