import OpenAI from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/local/qwen3-8b-2026-10-17T13-11-47-843Z-critic.json";
import invalidTransport from "./fixtures/local/qwen3-8b-2026-10-17T13-13-59-854Z-invalid-audit-sse.json";
import { applyComparisonFrame } from "../../app/comparison-progress";
import type { ExperimentRunMetadata } from "../../experiments/experiment-history";
import type { ExperimentEvent } from "../../experiments/types";
import type { ComparisonRunResult } from "../../experiments/comparison-types";
import { OpenAICompatibleModelProvider } from "./openai-compatible-model-provider";
import { CRITIC_INSTRUCTION } from "../critic-report";
import { prepareRun, createRunService } from "../../experiments/run-service";
import { getScenarioById } from "../../experiments/scenarios";
import { createComparisonPostHandler } from "../../app/api/experiments/compare/comparison-post-handler";
import type { ComparisonFrame } from "../../experiments/comparison-types";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const configurationId = "single-critic-audit-v1";
const scenario = getScenarioById(fixture.scenarioId)!;
const config = { baseURL: "http://replay.invalid/v1", model: fixture.model };
function setup() {
  vi.stubEnv("AGENTLAB_MODEL_PROVIDER", "openai-compatible");
  vi.stubEnv("OPENAI_COMPATIBLE_BASE_URL", config.baseURL);
  vi.stubEnv("OPENAI_COMPATIBLE_MODEL", config.model);
  vi.stubEnv("OPENAI_COMPATIBLE_API_KEY", "");
  vi.stubGlobal("fetch", () => { throw new Error("Unexpected network fallback"); });
}
function replay(slot: string, requests: { slot: string; body: Record<string, unknown> }[]) {
  const responses = fixture.responses.filter((r) => r.slot === (slot === "critic" ? "critic" : "producer"));
  let index = 0;
  const client = new OpenAI({ ...config, apiKey: "replay-only", maxRetries: 0, fetch: async (url, init) => {
    const request = new Request(url, init);
    expect(request.url).toBe(config.baseURL + "/chat/completions");
    requests.push({ slot, body: await request.json() });
    const response = responses[index++];
    if (!response) throw new Error("Replay exhausted; no network fallback");
    return Response.json(response.response);
  } });
  return new OpenAICompatibleModelProvider(config, client);
}

describe("real qwen3 Critic replay (offline, no generation)", () => {
  it("preserves the recorded producer bytes, real tools, one audit and independent evaluation", async () => {
    setup();
    const requests: { slot: string; body: Record<string, unknown> }[] = [];
    const append = vi.fn().mockResolvedValue(undefined);
    const result = await createRunService({ append }).executeRun(prepareRun({ task: scenario.task, scenarioId: scenario.id }, {
      configurationId, providerFor: (slot) => replay(slot, requests),
    }), { signal: new AbortController().signal });
    const producerText = fixture.responses.filter((r) => r.slot === "producer").at(-1)!.response.choices[0].message.content;
    expect(result.experiment.status).toBe(fixture.acceptance.status);
    expect(result.experiment.output?.text).toBe(producerText);
    expect(result.evaluation).toEqual(fixture.acceptance.evaluation);
    expect(result.audit).toMatchObject({ status: fixture.acceptance.auditStatus, producerModelCalls: 3, criticModelCalls: 1, report: { verdict: "no_issue", issues: [] } });
    expect(requests).toHaveLength(4);
    const audit = requests.at(-1)!;
    expect(audit.slot).toBe("critic"); expect(audit.body).not.toHaveProperty("tools");
    const messages = audit.body.messages as { role: string; content: string }[];
    expect(messages[0]).toEqual({ role: "system", content: CRITIC_INSTRUCTION });
    const data = JSON.parse(messages[1].content);
    expect(data.task).toBe(scenario.task);
    expect(Buffer.from(data.producerAnswer).equals(Buffer.from(result.experiment.output!.text))).toBe(true);
    expect(data.evidence.map((e: { id: number; toolName: string }) => [e.id, e.toolName])).toEqual([[1, "document_search"], [2, "document_search"]]);
    expect(result.events.filter((e) => e.type === "tool.completed")).toHaveLength(2);
    expect(result.events.filter((e) => e.type === "model.responded").map((e) => e.finishReason)).toEqual(["tool_call", "tool_call", "stop", "stop"]);
    expect(append).toHaveBeenCalledOnce();
    expect(append.mock.calls[0][0].events).toEqual(result.events);
    expect(append.mock.calls[0][0]).not.toHaveProperty("audit");
    const baseline = await createRunService({ append: async () => {} }).executeRun(prepareRun({ task: scenario.task, scenarioId: scenario.id }, {
      configurationId: "baseline", providerFor: () => replay("primary", []),
    }), { signal: new AbortController().signal });
    expect(result.experiment.output).toEqual(baseline.experiment.output);
    expect(result.evaluation).toEqual(baseline.evaluation);
  });

  it("produces equivalent V2 JSON/SSE terminal DTOs from identical real responses", async () => {
    setup();
    const body = { scenarioId: fixture.scenarioId, comparisonVersion: 2, configurationIds: ["baseline", configurationId] };
    const append = vi.fn().mockResolvedValue(undefined);
    const handler = createComparisonPostHandler({ append }, { createProviderFor: (_id, slot) => replay(slot, []) });
    const request = (stream: boolean) => new Request("http://localhost/api/experiments/compare", { method: "POST", body: JSON.stringify(body), headers: stream ? { Accept: "text/event-stream" } : {} });
    const json = await (await handler(request(false))).json();
    const frames: ComparisonFrame[] = (await (await handler(request(true))).text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const terminal = frames.at(-1);
    if (terminal?.type !== "comparison.finished") throw new Error("Missing terminal");
    // Independently admitted runs have fresh IDs and clocks; all behavioral fields stay exact.
    const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).filter(([k]) => !["id", "comparisonId", "durationMs"].includes(k)).map(([k, v]) => [k, stable(v)])) : value;
    expect(stable(terminal.result)).toEqual(stable(json));
    expect(json.runs[1]).toMatchObject({ metrics: { modelRequested: 4, modelResponded: 4, toolStarted: 2, toolCompleted: 2, toolFailed: 0, knownTokens: { input: 2320, output: 1103, total: 3423 }, unknownUsageCalls: 0 }, audit: { status: "completed" } });
    for (const record of append.mock.calls.slice(2).map((call) => call[0])) {
      expect(frames.flatMap((f) => f.type === "comparison.event" && f.event.experimentId === record.id ? [f.event] : [])).toEqual(record.events);
      expect(record).not.toHaveProperty("audit");
    }
    expect(append).toHaveBeenCalledTimes(4);
  });

  it("keeps explicit live provenance and only sanitized response fields", () => {
    expect(fixture).toMatchObject({ source: "live-ollama-scenario-smoke", model: "qwen3:8b", capturedAt: "2026-10-17T13:11:47.843Z", scenarioId: "document-chain-v1", configurationId, configurationVersion: 1, commit: "94d63ec", acceptance: { status: "completed", auditStatus: "completed", originalOutputPreserved: true } });
    expect(fixture.responses.map((r) => r.slot)).toEqual(["producer", "producer", "producer", "critic"]);
    for (const { response } of fixture.responses) {
      expect(Object.keys(response).sort()).toEqual(["choices", "created", "id", "object", "usage"]);
      expect(response.created).toBe(0); expect(response.id).toBe("recorded-completion");
      expect(JSON.stringify(response)).not.toMatch(/reasoning|<think>|system_fingerprint|https?:\/\/|authorization|chatcmpl-/i);
    }
  });

  it("preserves the real invalid_report transport outcome without inventing its unrecorded raw response", () => {
    expect(invalidTransport.source).toBe("live-ollama-v2-sse-excerpt");
    expect(invalidTransport.run).toMatchObject({ status: "failed", failureCode: "unknown", historySaved: true, evaluation: { passed: false }, audit: { status: "invalid_report", producerModelCalls: 2, criticModelCalls: 1 } });
    expect(invalidTransport.run.audit).not.toHaveProperty("report");
    expect(invalidTransport.events.filter((e) => e.type === "experiment.failed")).toHaveLength(1);
    expect(invalidTransport.events.filter((e) => e.type === "model.requested")).toHaveLength(3);
    expect(invalidTransport).not.toHaveProperty("responses");
    const run = invalidTransport.run as ComparisonRunResult;
    let state = applyComparisonFrame(null, { type: "comparison.started", comparisonId: "recorded-comparison", scenarioId: invalidTransport.scenarioId, configurations: [{ configurationId, label: "baseline + Critic", run: run.run as ExperimentRunMetadata }] });
    for (const event of invalidTransport.events) state = applyComparisonFrame(state, { type: "comparison.event", comparisonId: state.comparisonId, configurationId, event: event as ExperimentEvent });
    state = applyComparisonFrame(state, { type: "comparison.run.finished", comparisonId: state.comparisonId, run });
    expect(state.rows[0]).toMatchObject({ status: "failed", audit: { status: "invalid_report" }, result: { failureCode: "unknown" } });
    expect(JSON.stringify(invalidTransport)).not.toMatch(/producerAnswer|reasoning_content|<think>|authorization|https?:\/\//i);
  });
});
