import { afterEach, describe, expect, it, vi } from "vitest";
import qwen from "./fixtures/local/qwen3-8b-2026-10-15T13-50-09-621Z.json";
import llama from "./fixtures/local/llama3-1-8b-2026-10-15T13-50-37-331Z.json";
import { OpenAICompatibleModelProvider } from "./openai-compatible-model-provider";
import { SingleAgent } from "../single-agent";
import { CalculatorTool } from "../../tools/calculator-tool";
import type { ModelMessage } from "../model-provider";

// Live response envelopes only. Requests are reconstructed; transport never reaches a server.
function replay(model: string, responses: readonly object[]) {
  const requests: Request[] = [];
  vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(url, init));
    const response = responses[requests.length - 1];
    if (!response) throw new Error("Replay exhausted; network fallback is forbidden.");
    return Response.json(response);
  });
  return { requests, provider: new OpenAICompatibleModelProvider({ baseURL: "http://replay.invalid/v1", model }) };
}
afterEach(() => vi.unstubAllGlobals());

describe("sanitized real Ollama response replay (no live API)", () => {
  it.each([qwen, llama])("maps recorded text and usage from $model", async (fixture) => {
    const raw = fixture.responses[0].response;
    const { provider, requests } = replay(fixture.model, [raw]);
    await expect(provider.complete({ messages: [{ role: "user", text: "Explain a thermostat." }], tools: [] })).resolves.toEqual({
      type: "text", text: raw.choices[0].message.content, finishReason: "stop", usage: {
        inputTokens: raw.usage.prompt_tokens, outputTokens: raw.usage.completion_tokens, totalTokens: raw.usage.total_tokens,
      },
    });
    expect(requests).toHaveLength(1);
  });
  it("replays qwen's two sequential tool turns and final 410 through the agent", async () => {
    const responses = qwen.responses.filter((entry) => entry.scenario === "calculator-two-turns").map((entry) => entry.response);
    expect(responses).toHaveLength(3);
    expect(responses.slice(0, 2).map((raw) => {
      const message = raw.choices[0].message;
      return "tool_calls" in message ? message.tool_calls.length : 0;
    })).toEqual([1, 1]);
    const { provider, requests } = replay(qwen.model, responses);
    const tools: string[] = [];
    const result = await new SingleAgent(provider, [new CalculatorTool()]).run("Use the calculator twice, then report the final result.",
      (event) => { if (event.type === "tool.completed") tools.push(event.toolName); });
    expect(result.text).toMatch(/\b410\b/);
    expect(tools).toEqual(["calculator", "calculator"]);
    expect(requests).toHaveLength(3);
    const body = await requests[2].json();
    expect(body.messages.filter((m: ModelMessage) => m.role === "tool")).toEqual([
      { role: "tool", tool_call_id: "recorded-call-1-1", content: "391" },
      { role: "tool", tool_call_id: "recorded-call-2-1", content: "410" },
    ]);
  });
  it("rejects llama's recorded two-call response before executing either tool", async () => {
    const raw = llama.responses[1].response;
    const message = raw.choices[0].message;
    expect("tool_calls" in message ? message.tool_calls : []).toHaveLength(2);
    const { provider, requests } = replay(llama.model, [raw]);
    const toolEvents: string[] = [];
    await expect(new SingleAgent(provider, [new CalculatorTool()]).run("Use the calculator twice.",
      (event) => toolEvents.push(event.type))).rejects.toMatchObject({ failureCode: "invalid_tool_call" });
    expect(toolEvents).toEqual([]);
    expect(requests).toHaveLength(1);
  });
  it("keeps provenance while excluding reasoning, raw IDs, addresses and unused fields", () => {
    for (const fixture of [qwen, llama]) {
      expect(fixture.source).toBe("live-ollama-smoke");
      expect(fixture.capturedAt).toMatch(/^2026-10-15T/);
      expect(fixture.promptVersion).toBe("bf220ed");
      for (const entry of fixture.responses) {
        expect(entry.response.id).toBe("recorded-completion");
        expect(entry.response.created).toBe(0);
        expect(Object.keys(entry.response).sort()).toEqual(["choices", "created", "id", "object", "usage"]);
        const serialized = JSON.stringify(entry.response);
        expect(serialized).not.toMatch(/reasoning|<think>|system_fingerprint|https?:\/\/|authorization|chatcmpl-/i);
      }
    }
  });
});
