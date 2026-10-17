import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/local/qwen3-8b-2026-10-17T11-53-27-662Z.json";
import { OpenAICompatibleModelProvider } from "./openai-compatible-model-provider";
import { createArchitectureRunner } from "../architecture-registry";
import { getScenarioById } from "../../experiments/scenarios";
import { runExperiment } from "../../experiments/run-experiment";
import type { ExperimentEvent } from "../../experiments/types";
import { createTools } from "../../tools/tool-registry";

afterEach(() => vi.unstubAllGlobals());

describe("real qwen3 document response replay (offline)", () => {
  it("preserves three successful tools and the recorded final-format evaluation failure", async () => {
    const requests: Request[] = [];
    vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(url, init));
      const recorded = fixture.responses[requests.length - 1];
      if (!recorded) throw new Error("Replay exhausted; network fallback is forbidden.");
      return Response.json(recorded.response);
    });
    const scenario = getScenarioById(fixture.scenarioId)!;
    const provider = new OpenAICompatibleModelProvider({ baseURL: "http://replay.invalid/v1", model: fixture.model });
    const runner = createArchitectureRunner("baseline", {
      createProviderFor: () => provider,
      createTools: () => createTools(scenario.toolIds),
    });
    const events: ExperimentEvent[] = [];
    const experiment = await runExperiment(scenario.task, runner, (event) => events.push(event));

    expect(experiment.status).toBe("completed");
    expect(experiment.output?.text).toBe("RESULT\ntotal_credits=161; sources=order-cobalt,rate-m4");
    expect(scenario.evaluate?.(experiment, events)).toEqual({
      passed: false, reason: "Document scenario failed: result format.",
    });
    expect(events.filter((event) => event.type === "tool.completed").map((event) => event.toolName))
      .toEqual(["document_search", "document_search", "calculator"]);
    expect(events.filter((event) => event.type === "model.responded").map((event) => event.finishReason))
      .toEqual(["tool_call", "tool_call", "tool_call", "stop"]);
    expect(requests).toHaveLength(4);

    const first = await requests[0].json();
    expect(first.tools.map((tool: { function: { name: string } }) => tool.function.name))
      .toEqual(["document_search", "calculator"]);
    const last = await requests[3].json();
    const results = last.messages.filter((message: { role: string }) => message.role === "tool");
    expect(results.map((message: { tool_call_id: string }) => message.tool_call_id))
      .toEqual(["recorded-call-1-1", "recorded-call-2-1", "recorded-call-3-1"]);
    expect(JSON.parse(results[0].content).results.map((document: { id: string }) => document.id)).toEqual(["order-cobalt"]);
    expect(JSON.parse(results[1].content).results.map((document: { id: string }) => document.id)).toEqual(["rate-m4", "order-cobalt"]);
    expect(results[2].content).toBe("161");
    expect(events.filter((event) => event.type === "experiment.completed")).toHaveLength(1);
  });

  it("keeps real scenario provenance and only allowlisted sanitized response fields", () => {
    expect(fixture).toMatchObject({
      source: "live-ollama-scenario-smoke", model: "qwen3:8b",
      scenarioId: "document-calculation-v1", corpusVersion: "agentlab-docs-v1",
      configurationId: "baseline", configurationVersion: 1,
      commit: "4444a83", promptVersion: "document-scenarios-v1",
    });
    expect(fixture.capturedAt).toBe("2026-10-17T11:53:27.662Z");
    expect(fixture.responses).toHaveLength(4);
    for (const { scenario, response } of fixture.responses) {
      expect(scenario).toBe(fixture.scenarioId);
      expect(response.id).toBe("recorded-completion");
      expect(response.created).toBe(0);
      expect(Object.keys(response).sort()).toEqual(["choices", "created", "id", "object", "usage"]);
      const message = response.choices[0].message;
      expect(Object.keys(message).sort()).toEqual("tool_calls" in message ? ["content", "role", "tool_calls"] : ["content", "role"]);
      expect(JSON.stringify(response)).not.toMatch(/reasoning|<think>|system_fingerprint|https?:\/\/|authorization|chatcmpl-/i);
    }
  });
});
