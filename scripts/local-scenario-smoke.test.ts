import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parseSmokeArguments, runLocalSmoke } from "./local-smoke";
import { recordingProvenance, type LocalResponseRecording } from "./local-response-recording";
import { SCENARIOS } from "../src/experiments/scenarios";
import { DocumentSearchTool } from "../src/tools/document-search-tool";

const config = { baseURL: "http://127.0.0.1:11434/v1", model: "synthetic-test-model" };
const scenarios = [SCENARIOS[5], SCENARIOS[6], SCENARIOS[7]];

describe("opt-in local scenario smoke (synthetic transport only)", () => {
  it.each([[], ["--check"], ["--record"], ["--scenario", "document-chain-v1"], ["--record", "--scenario", "document-calculation-v1"]].map((args) => ({ args })))("accepts explicit CLI options $args", ({ args }) => {
    expect(() => parseSmokeArguments(args)).not.toThrow();
  });
  it.each([["--check", "--record"], ["--check", "--scenario", "document-chain-v1"], ["--scenario"], ["--scenario", "direct-text"], ["--scenario", "unknown"], ["--scenario", "document-chain-v1", "--scenario", "document-conflict-v1"], ["--record", "--record"], ["--other"]].map((args) => ({ args })))("rejects invalid CLI options $args before dispatch", ({ args }) => {
    expect(() => parseSmokeArguments(args)).toThrow();
  });
  for (const scenario of scenarios) it(`${scenario.id}: uses registry task, schema, evaluator and real tools without history`, async () => {
    const requests: { messages: { role: string; content: string }[]; tools: { function: { name: string } }[] }[] = [];
    const recordings: LocalResponseRecording[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      const request = new Request(url, init);
      expect(init?.redirect).toBe("error");
      const body = await request.json(); requests.push(body);
      const turn = body.messages.filter((message: { role: string }) => message.role === "tool").length;
      const response = scenario.fakeByKind.single.primary[turn];
      return Response.json({ choices: [{ finish_reason: response.type === "text" ? "stop" : "tool_calls", message: {
        role: "assistant", content: response.type === "text" ? response.text : null,
        ...(response.type === "tool_call" ? { tool_calls: [{ id: response.call.callId, type: "function", function: { name: response.call.toolName, arguments: JSON.stringify(response.call.arguments) } }] } : {}),
      } }], usage: { prompt_tokens: 0, completion_tokens: 2, total_tokens: 2 } });
    };
    const report = await runLocalSmoke(config, fetcher, { scenarioId: scenario.id, record: (record) => recordings.push(record), timeoutMs: 5000 });
    expect(report.ok).toBe(true);
    expect(report.historyWritten).toBe(false);
    expect(report.scenarios).toHaveLength(1);
    const summary = report.scenarios[0];
    expect(summary).toMatchObject({ scenarioId: scenario.id, corpusVersion: "agentlab-docs-v1", configurationId: "baseline", configurationVersion: 1, evaluation: { passed: true } });
    expect(requests[0].messages[0].content).toBe(scenario.task);
    expect(requests.every((request) => request.tools.map((tool) => tool.function.name).join(",") === "document_search,calculator")).toBe(true);
    expect(recordings).toHaveLength(requests.length);
    expect(JSON.stringify(report)).not.toMatch(/RESULT|dock-r2|rate-m4|order-cobalt|127\.0\.0\.1|query|unit price/);
    if (scenario.id === "document-calculation-v1") {
      expect(summary.toolNames).toEqual(["document_search", "document_search", "calculator"]);
      const outputs = requests.at(-1)!.messages.filter((message) => message.role === "tool").map((message) => message.content);
      expect(outputs).toEqual([await new DocumentSearchTool().execute({ query: "order-cobalt" }), await new DocumentSearchTool().execute({ query: "rate-m4" }), "161"]);
    }
  });
  it("rejects unsupported scenarios before transport and reports FAIL without automatic resampling", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Wrong" } }] }));
    await expect(runLocalSmoke(config, fetcher, { scenarioId: "calculator-once" })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    const report = await runLocalSmoke(config, fetcher, { scenarioId: "document-calculation-v1" });
    expect(report.ok).toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(report.scenarios[0].evaluation).toMatchObject({ passed: false });
  });
  it("keeps old recording headers and separates new task provenance", () => {
    expect(recordingProvenance("model", "date")).toEqual({ source: "live-ollama-smoke", model: "model", capturedAt: "date", promptVersion: "bf220ed" });
    expect(recordingProvenance("model", "date", "document-calculation-v1")).toMatchObject({ source: "live-ollama-scenario-smoke", scenarioId: "document-calculation-v1", corpusVersion: "agentlab-docs-v1", configurationId: "baseline", configurationVersion: 1, promptVersion: "document-scenarios-v1", commit: expect.stringMatching(/^[a-f0-9]+$/) });
    const source = readFileSync(new URL("smoke-local.mjs", import.meta.url), "utf8");
    expect(source).toContain("LOCALAPPDATA: directory, XDG_DATA_HOME: directory");
    expect(source).toContain("--scenario");
  });
});
