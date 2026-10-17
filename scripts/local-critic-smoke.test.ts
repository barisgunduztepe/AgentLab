import { expect, it, vi } from "vitest";
import { parseSmokeArguments, runLocalSmoke } from "./local-smoke";
import { recordingProvenance, type LocalResponseRecording } from "./local-response-recording";
import { SCENARIOS } from "../src/experiments/scenarios";

const configurationId = "single-critic-audit-v1";
const config = { baseURL: "http://127.0.0.1:11434/v1", model: "synthetic-test-model" };
it("requires explicit compatible scenario/config CLI selection and preserves default options", () => {
  expect(parseSmokeArguments([])).toEqual({ check: false, record: false });
  expect(parseSmokeArguments(["--scenario", "document-chain-v1", "--configuration", configurationId, "--record"])).toEqual({ check: false, record: true, scenarioId: "document-chain-v1", configurationId });
  for (const args of [["--configuration", configurationId], ["--scenario", "document-chain-v1", "--configuration", "handoff-default"], ["--scenario", "document-chain-v1", "--configuration", "missing"], ["--check", "--configuration", configurationId]]) expect(() => parseSmokeArguments(args)).toThrow();
  expect(recordingProvenance("model", "date", "document-chain-v1", configurationId)).toMatchObject({ configurationId, configurationVersion: 1 });
});
it.each([SCENARIOS[5], SCENARIOS[6], SCENARIOS[7]])("$id: runs synthetic Critic smoke with separate slots, bounded report and no history", async (scenario) => {
  const requests: Record<string, unknown>[] = [];
  const recordings: LocalResponseRecording[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const request = new Request(url, init); const body = await request.json(); requests.push(body);
    const critic = !body.tools?.length;
    const turn = body.messages.filter((m: { role: string }) => m.role === "tool").length;
    const response = critic ? { type: "text" as const, text: '{"verdict":"no_issue","issues":[]}' } : scenario.fakeByKind.single.primary[turn];
    return Response.json({ choices: [{ finish_reason: response.type === "text" ? "stop" : "tool_calls", message: { role: "assistant", content: response.type === "text" ? response.text : null,
      ...(response.type === "tool_call" ? { tool_calls: [{ id: response.call.callId, type: "function", function: { name: response.call.toolName, arguments: JSON.stringify(response.call.arguments) } }] } : {}) } }] });
  });
  const report = await runLocalSmoke(config, fetcher, { scenarioId: scenario.id, configurationId, record: (r) => recordings.push(r) });
  expect(report.historyWritten).toBe(false); expect(report.ok).toBe(true);
  expect(report.scenarios[0]).toMatchObject({ configurationId, audit: { status: "completed", report: { verdict: "no_issue" }, criticModelCalls: 1 } });
  expect(fetcher.mock.calls.length).toBeLessThanOrEqual(5);
  expect(requests.at(-1)).not.toHaveProperty("tools");
  expect(recordings.at(-1)?.slot).toBe("critic");
  expect(recordings.slice(0, -1).every((r) => r.slot === "producer")).toBe(true);
  expect(JSON.stringify(report)).not.toMatch(/RESULT|query|127\.0\.0\.1|producerAnswer/);
});
it("rejects unsupported direct smoke options without a probe or generation", async () => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(runLocalSmoke(config, fetcher, { configurationId })).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
