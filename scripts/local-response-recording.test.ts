import { describe, expect, it } from "vitest";
import { sanitizeLocalResponse } from "./local-response-recording";

describe("local response recording allowlist (synthetic inputs only)", () => {
  it("drops private fields and reasoning, normalizes IDs, preserves calls and reported usage", () => {
    const response = sanitizeLocalResponse({ id: "private-id", created: 123, system_fingerprint: "private-fingerprint",
      model: "private-model", reasoning: "private-thought", headers: { authorization: "private-key" },
      choices: [{ finish_reason: "tool_calls", logprobs: "private-logprobs", message: { role: "assistant",
        reasoning: "private-thought", reasoning_content: "private-thought", content: "<think>private-thought</think>Visible private-key http://secret.example",
        tool_calls: [{ id: "private-call", type: "function", function: { name: "calculator", arguments: '{"expression":"17 * 23"}', extra: "private" } }] } }],
      usage: { prompt_tokens: 0, completion_tokens: 9, private_details: "private", total_tokens: 9 } }, ["private-key"], 2);
    expect(response.choices[0].message.content).toBe("Visible [redacted] [address]");
    expect(response.choices[0].message.tool_calls?.[0]).toEqual({ id: "recorded-call-2-1", type: "function",
      function: { name: "calculator", arguments: '{"expression":"17 * 23"}' } });
    expect(response.usage).toEqual({ prompt_tokens: 0, completion_tokens: 9, total_tokens: 9 });
    expect(JSON.stringify(response)).not.toContain("private");
    expect(response.created).toBe(0);
  });
  it("does not invent missing totals and strips an unclosed reasoning block", () => {
    const response = sanitizeLocalResponse({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Visible<think>hidden" } }],
      usage: { prompt_tokens: 2 } });
    expect(response.usage).toEqual({ prompt_tokens: 2 });
    expect(response.choices[0].message.content).toBe("Visible");
  });
});
