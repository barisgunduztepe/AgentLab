import OpenAI from "openai";
import { afterEach, expect, it, vi } from "vitest";
import fixture from "./fixtures/local/qwen3-8b-2026-10-17-handoff.json";
import criticFailure from "./fixtures/local/qwen3-8b-2026-10-17-multi-critic-format-fail-sse.json";
import { OpenAICompatibleModelProvider } from "./openai-compatible-model-provider";
import { createRunService, prepareRun } from "../../experiments/run-service";
import { getScenarioById } from "../../experiments/scenarios";
import { createComparisonPostHandler } from "../../app/api/experiments/compare/comparison-post-handler";
import { applyComparisonFrame } from "../../app/comparison-progress";
import { ARCHITECTURE_DEFINITIONS, type RunConfigurationId } from "../architecture-definitions";
import type { ComparisonFrame, ComparisonRunResult } from "../../experiments/comparison-types";
import type { ExperimentEvent } from "../../experiments/types";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const config = { baseURL: "http://replay.invalid/v1", model: "qwen3:8b" };
const scenario = getScenarioById(fixture.scenarioId)!;
function setup() {
  vi.stubEnv("AGENTLAB_MODEL_PROVIDER", "openai-compatible");
  vi.stubEnv("OPENAI_COMPATIBLE_BASE_URL", config.baseURL);
  vi.stubEnv("OPENAI_COMPATIBLE_MODEL", config.model);
  vi.stubEnv("OPENAI_COMPATIBLE_API_KEY", "");
  vi.stubGlobal("fetch", () => { throw new Error("No network fallback in replay"); });
}
function replay(slot: string, requests: { slot: string; body: Record<string, unknown> }[]) {
  const snapshots = fixture.responses.filter((r) => r.slot === (slot === "finalizer" ? "finalizer" : "analyst"));
  let index = 0;
  const client = new OpenAI({ ...config, apiKey: "offline-replay", maxRetries: 0, fetch: async (url, init) => {
    const request = new Request(url, init);
    expect(request.url).toBe(config.baseURL + "/chat/completions");
    requests.push({ slot, body: await request.json() });
    const snapshot = snapshots[index++];
    if (!snapshot) throw new Error("Replay exhausted");
    return Response.json(snapshot.response);
  } });
  return new OpenAICompatibleModelProvider(config, client);
}

it("replays the actual handoff through real tools and the shared evaluator, preserving notes and final bytes", async () => {
  setup();
  const requests: { slot: string; body: Record<string, unknown> }[] = [];
  const append = vi.fn().mockResolvedValue(undefined);
  const result = await createRunService({ append }).executeRun(prepareRun({ task: scenario.task, scenarioId: scenario.id }, {
    configurationId: "handoff-documents-v1", providerFor: (slot) => replay(slot, requests),
  }), { signal: new AbortController().signal });
  const analyst = fixture.responses.filter((r) => r.slot === "analyst").at(-1)!.response.choices[0].message.content;
  const finalizer = fixture.responses.filter((r) => r.slot === "finalizer").at(-1)!.response.choices[0].message.content;
  expect(result.experiment.status).toBe(fixture.acceptance.status);
  expect(result.evaluation).toEqual(fixture.acceptance.evaluation);
  expect(result.experiment.output?.text).toBe(finalizer);
  expect(requests).toHaveLength(fixture.responses.length);
  expect(requests.filter((r) => r.slot === "analyst").length).toBeLessThanOrEqual(4);
  const request = requests.at(-1)!;
  expect(request.slot).toBe("finalizer"); expect(request.body).not.toHaveProperty("tools");
  const messages = request.body.messages as { role: string; content: string }[];
  expect(messages).toHaveLength(1); expect(messages[0].role).toBe("user");
  expect(messages[0].content).toContain(scenario.task);
  const notes = messages[0].content.split("Analyst context:\n---\n")[1].slice(0, -4);
  expect(Buffer.from(notes).equals(Buffer.from(analyst!))).toBe(true);
  expect(Buffer.byteLength(notes)).toBeLessThanOrEqual(8192);
  const tools = result.events.filter((e) => e.type === "tool.completed");
  expect(tools.map((e) => e.toolName)).toEqual(["document_search", "document_search"]);
  expect(tools.every((e) => e.agentId === "analyst")).toBe(true);
  expect(result.events.filter((e) => e.type === "handoff.completed")).toHaveLength(1);
  expect(result.events.filter((e) => e.type === "model.responded").map((e) => e.usage)).toEqual(fixture.responses.map((r) => ({
    inputTokens: r.response.usage.prompt_tokens, outputTokens: r.response.usage.completion_tokens, totalTokens: r.response.usage.total_tokens,
  })));
  expect(append).toHaveBeenCalledOnce();
  expect(append.mock.calls[0][0].events).toEqual(result.events);
  expect(append.mock.calls[0][0].run).toMatchObject({ architecture: "handoff", agentConfigurationId: "handoff-documents-v1", agentConfigurationVersion: 1 });
  expect(append.mock.calls[0][0]).not.toHaveProperty("audit");
});

it("keeps identical real response replay behavior across V2 JSON/SSE and exact nested events in history", async () => {
  setup();
  const append = vi.fn().mockResolvedValue(undefined);
  const body = { scenarioId: scenario.id, comparisonVersion: 2, configurationIds: ["baseline", "handoff-documents-v1"] };
  const handler = createComparisonPostHandler({ append }, { createProviderFor: (_id, slot) => replay(slot, []) });
  const request = (stream: boolean) => new Request("http://localhost/api/experiments/compare", {
    method: "POST", body: JSON.stringify(body), headers: stream ? { Accept: "text/event-stream" } : {},
  });
  const json = await (await handler(request(false))).json();
  const frames: ComparisonFrame[] = (await (await handler(request(true))).text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
  const terminal = frames.at(-1);
  if (terminal?.type !== "comparison.finished") throw new Error("Missing terminal");
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).filter(([k]) => !["id", "comparisonId", "durationMs"].includes(k)).map(([k, v]) => [k, stable(v)])) : value;
  expect(stable(terminal.result)).toEqual(stable(json));
  expect(json.runs[1].evaluation).toEqual(fixture.acceptance.evaluation);
  for (const record of append.mock.calls.slice(2).map((call) => call[0])) {
    expect(frames.flatMap((f) => f.type === "comparison.event" && f.event.experimentId === record.id ? [f.event] : [])).toEqual(record.events);
  }
  expect(append).toHaveBeenCalledTimes(4);
});

it("retains live provenance and sanitized native response fields without reasoning or requests", () => {
  expect(fixture).toMatchObject({ source: "live-ollama-scenario-smoke", model: "qwen3:8b", commit: "0286ea6", scenarioId: "document-chain-multi-v1", configurationId: "handoff-documents-v1", configurationVersion: 1,
    acceptance: { attempt: 1, noteEqual: true, outputEqual: true, finalizerTools: 0 } });
  expect(fixture.responses.map((r) => r.slot)).toEqual(["analyst", "analyst", "analyst", "finalizer"]);
  for (const { response } of fixture.responses) {
    expect(Object.keys(response).sort()).toEqual(["choices", "created", "id", "object", "usage"]);
    expect(response.created).toBe(0); expect(response.id).toBe("recorded-completion");
    expect(JSON.stringify(response)).not.toMatch(/reasoning|<think>|system_fingerprint|https?:\/\/|authorization|chatcmpl-/i);
  }
});

it("replays the actual no_issue plus completed/FAIL in a four-row UI without changing evaluator status", () => {
  expect(criticFailure.source).toBe("live-ollama-v2-sse-excerpt");
  expect(criticFailure).not.toHaveProperty("responses");
  expect(criticFailure.run).toMatchObject({ status: "completed", evaluation: { passed: false, reason: "Document scenario failed: result format." }, audit: { status: "completed", report: { verdict: "no_issue" } } });
  const run = criticFailure.run as ComparisonRunResult;
  const ids: RunConfigurationId[] = ["baseline", "structured", "single-critic-audit-v1", "handoff-documents-v1"];
  let state = applyComparisonFrame(null, { type: "comparison.started", comparisonVersion: 2, comparisonId: "recorded-comparison", scenarioId: criticFailure.scenarioId,
    configurations: ids.map((id) => ({ configurationId: id, label: ARCHITECTURE_DEFINITIONS[id].label,
      run: { ...run.run, architecture: ARCHITECTURE_DEFINITIONS[id].architecture, agentConfigurationId: id } })) });
  for (const event of criticFailure.events) state = applyComparisonFrame(state, { type: "comparison.event", comparisonId: state.comparisonId, configurationId: run.configurationId, event: event as ExperimentEvent });
  state = applyComparisonFrame(state, { type: "comparison.run.finished", comparisonId: state.comparisonId, run });
  expect(state.rows).toHaveLength(4);
  expect(state.rows[2]).toMatchObject({ status: "completed", result: { evaluation: { passed: false } }, audit: { report: { verdict: "no_issue" } } });
  expect(state.rows[3]).toMatchObject({ configurationId: "handoff-documents-v1", status: "queued", events: [] });
});
