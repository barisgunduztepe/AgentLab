import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleModelProvider, getOpenAICompatibleConfiguration } from "./openai-compatible-model-provider";
import { createModelProvider, describeConfiguredProvider } from "../create-model-provider";
import { createRunMetadata } from "../../experiments/run-metadata";
import { describeRunForDisplay } from "../../experiments/run-label";
import { SingleAgent } from "../single-agent";
import type { CompleteRequest } from "../model-provider";

const config = { baseURL: "http://localhost:11434/v1", model: "test-model" };
const request: CompleteRequest = { messages: [{ role: "user", text: "Explain" }], tools: [] };
function response(finish_reason = "stop", content: string | null = "Done", tool_calls?: unknown) {
  return { id: "private-completion-id", object: "chat.completion", model: "test-model", created: 0,
    choices: [{ index: 0, finish_reason, message: { role: "assistant", content, ...(tool_calls === undefined ? {} : { tool_calls }) } }] };
}
function transport(body: object, status = 200) {
  const calls: Request[] = [];
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push(new Request(url, init)); return Response.json(body, { status });
  });
  vi.stubGlobal("fetch", fetcher);
  return { calls, fetcher };
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("OpenAI-compatible Chat Completions", () => {
  it("uses only its configured endpoint and does not inherit OpenAI credentials or headers", async () => {
    vi.stubEnv("OPENAI_API_KEY", "private-cloud-key"); vi.stubEnv("OPENAI_ADMIN_KEY", "private-admin-key");
    vi.stubEnv("OPENAI_ORG_ID", "private-org"); vi.stubEnv("OPENAI_PROJECT_ID", "private-project");
    vi.stubEnv("OPENAI_BASE_URL", "http://private-cloud.example/v1");
    const { calls } = transport(response());
    const result = await new OpenAICompatibleModelProvider(config).complete(request);
    expect(calls[0].url).toBe("http://localhost:11434/v1/chat/completions");
    expect(calls[0].headers.has("authorization")).toBe(false);
    expect(calls[0].headers.has("openai-organization")).toBe(false);
    expect(calls[0].headers.has("openai-project")).toBe(false);
    expect(await calls[0].json()).toEqual({ model: "test-model", messages: request.messages.map((m) => ({ role: m.role, content: "Explain" })), stream: false });
    expect(result).toEqual({ type: "text", text: "Done", finishReason: "stop", usage: null });
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("sends an explicitly configured key only as authorization", async () => {
    const { calls } = transport(response());
    await new OpenAICompatibleModelProvider({ ...config, apiKey: "private-local-key" }).complete(request);
    expect(calls[0].headers.get("authorization")).toBe("Bearer private-local-key");
    expect(await calls[0].text()).not.toContain("private-local-key");
  });
  it.each(["stop", "length", "content_filter", "unrecognized"])("normalizes text finish reason %s", async (reason) => {
    transport(response(reason));
    await expect(new OpenAICompatibleModelProvider(config).complete(request)).resolves.toMatchObject({ finishReason: reason === "unrecognized" ? "unknown" : reason });
  });
  it("maps an explicit refusal without retaining private refusal text", async () => {
    const raw = response(); Object.assign(raw.choices[0].message, { content: null, refusal: "private refusal" });
    transport(raw);
    await expect(new OpenAICompatibleModelProvider(config).complete(request)).resolves.toMatchObject({ type: "text", text: "", finishReason: "refusal" });
  });
  it.each(["not-json", "[]", "null", "3"])("rejects malformed JSON tool arguments: %s", async (args) => {
    transport(response("tool_calls", null, [{ id: "one", type: "function", function: { name: "lookup", arguments: args } }]));
    await expect(new OpenAICompatibleModelProvider(config).complete(request)).rejects.toMatchObject({ failureCode: "invalid_tool_call" });
  });
  it("rejects multiple native calls before the agent can execute anything", async () => {
    const call = { id: "one", type: "function", function: { name: "calculator", arguments: '{"expression":"1+1"}' } };
    transport(response("tool_calls", null, [call, { ...call, id: "two" }]));
    await expect(new OpenAICompatibleModelProvider(config).complete(request)).rejects.toMatchObject({ failureCode: "invalid_tool_call" });
  });
  it.each([[], [{}], null])("rejects tool_calls without a valid function call", async (tool_calls) => {
    transport(response("tool_calls", null, tool_calls));
    await expect(new OpenAICompatibleModelProvider(config).complete(request)).rejects.toMatchObject({ failureCode: "invalid_tool_call" });
  });
  it.each([401, 403, 429])("does not retry auth or ambiguous quota errors: %s", async (status) => {
    const { calls } = transport({ error: { message: "private-key private-address", code: "insufficient_quota" } }, status);
    const { RetryingModelProvider } = await import("./retrying-model-provider");
    const events: object[] = [];
    const agent = new SingleAgent(new RetryingModelProvider(new OpenAICompatibleModelProvider(config)));
    await expect(agent.run("Explain", undefined, (e) => events.push(e))).rejects.toMatchObject({ failureCode: "provider_error" });
    expect(calls).toHaveLength(1); expect(JSON.stringify(events)).not.toContain("private");
  });
  it.each([408, 500, 502, 503, 504])("classifies temporary HTTP %s as retryable", async (status) => {
    transport({ error: { message: "private detail" } }, status);
    await expect(new OpenAICompatibleModelProvider(config).complete(request)).rejects.toMatchObject({ name: "RetryableProviderError", message: "Provider request failed." });
  });
  it("classifies only an explicit rate-limit code as retryable", async () => {
    transport({ error: { code: "rate_limit_exceeded" } }, 429);
    await expect(new OpenAICompatibleModelProvider(config).complete(request)).rejects.toMatchObject({ name: "RetryableProviderError" });
  });
  it.each([{}, { choices: [] }, { choices: [{ message: { role: "assistant", content: null }, finish_reason: "stop" }] }])
    ("rejects incomplete reply envelopes", async (body) => {
      transport(body); await expect(new OpenAICompatibleModelProvider(config).complete(request)).rejects.toThrow();
    });
});

describe("compatible configuration and metadata", () => {
  it.each(["", "not a url", "file:///tmp/model", "http://user:password@localhost/v1", "http://localhost/v1?key=secret", "http://localhost/v1#fragment"])
    ("rejects invalid base URLs safely", (baseURL) => {
      expect(() => new OpenAICompatibleModelProvider({ ...config, baseURL })).toThrow(/OPENAI_COMPATIBLE_BASE_URL/);
    });
  it("requires a model and never falls back to the OpenAI cloud model", () => {
    vi.stubEnv("OPENAI_MODEL", "cloud-model");
    expect(() => getOpenAICompatibleConfiguration({ OPENAI_COMPATIBLE_BASE_URL: config.baseURL })).toThrow("OPENAI_COMPATIBLE_MODEL is not configured.");
  });
  it("selects the provider explicitly and records only provider and model", () => {
    vi.stubEnv("AGENTLAB_MODEL_PROVIDER", "openai-compatible");
    vi.stubEnv("OPENAI_COMPATIBLE_BASE_URL", "http://private-local.example/v1");
    vi.stubEnv("OPENAI_COMPATIBLE_MODEL", " test-model "); vi.stubEnv("OPENAI_COMPATIBLE_API_KEY", "private-local-key");
    expect(createModelProvider()).toBeDefined();
    expect(describeConfiguredProvider()).toEqual({ provider: "openai-compatible", model: "test-model" });
    const run = createRunMetadata({ architecture: "single", agentConfigurationId: "baseline" }, { getCommit: () => undefined });
    expect(JSON.stringify(run)).not.toContain("private");
    expect(describeRunForDisplay(run)).toMatchObject({ isFake: false, badge: "openai-compatible", provider: "openai-compatible · test-model" });
  });
});
