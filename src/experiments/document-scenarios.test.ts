import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARCHITECTURE_DEFINITIONS } from "../agent/architecture-definitions";
import { FakeModelProvider } from "../agent/providers/fake-model-provider";
import type { CompleteRequest } from "../agent/model-provider";
import { TOOL_FACTORIES, createTools } from "../tools/tool-registry";
import { DocumentSearchTool } from "../tools/document-search-tool";
import { CalculatorTool } from "../tools/calculator-tool";
import { SCENARIOS, getScenarioById, comparisonConfigurations } from "./scenarios";
import { createRunService, prepareRun } from "./run-service";
import { ExperimentHistoryStore } from "./experiment-history";
import type { Experiment, ExperimentEvent } from "./types";

const scenarios = [SCENARIOS[5], SCENARIOS[6], SCENARIOS[7]];
const signal = () => new AbortController().signal;
beforeEach(() => vi.stubEnv("AGENTLAB_MODEL_PROVIDER", "fake"));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("document scenarios", () => {
  it("preserves old tasks, plans and configuration versions and validates every catalog relationship", () => {
    expect(createHash("sha256").update(JSON.stringify(SCENARIOS.slice(0, 5))).digest("hex")).toMatchInlineSnapshot(`"4237235d927548dec449c27bdc8ca2ba6f21248902693223a90aa3355e406aec"`);
    expect(SCENARIOS).toHaveLength(8);
    expect(SCENARIOS.filter((scenario) => comparisonConfigurations(scenario).length === 2)).toHaveLength(7);
    for (const scenario of SCENARIOS) {
      expect(new Set(scenario.toolIds).size).toBe(scenario.toolIds.length);
      for (const toolId of scenario.toolIds) expect(Object.hasOwn(TOOL_FACTORIES, toolId)).toBe(true);
      for (const kind of scenario.compatibleKinds) {
        for (const entry of Object.values(ARCHITECTURE_DEFINITIONS).filter((entry) => entry.scenarioKind === kind)) {
          expect(entry.version).toBe(1);
          for (const slot of entry.providerSlots) expect(getScenarioById(scenario.id)!.fakeByKind[kind][slot].length).toBeGreaterThan(0);
        }
      }
    }
  });
  for (const scenario of scenarios) for (const configurationId of ["baseline", "structured"] as const) {
    it(`${scenario.id}/${configurationId}: uses real tools, isolated state, one evaluation/terminal/append and v3 roundtrip`, async () => {
      const directory = await mkdtemp(join(tmpdir(), "agentlab-docs-"));
      try {
        const store = new ExperimentHistoryStore(join(directory, "experiments.json"));
        const append = vi.spyOn(store, "append");
        const requests: CompleteRequest[] = [];
        const providers: FakeModelProvider[] = [];
        const plan = () => prepareRun({ task: scenario.task, scenarioId: scenario.id }, { configurationId, providerFor: () => {
          const provider = new FakeModelProvider(scenario.fakeByKind.single.primary);
          providers.push(provider);
          return { complete: async (request) => { requests.push(structuredClone({ ...request, signal: undefined })); return provider.complete(request); } };
        } });
        const first = plan(); const second = plan();
        const result = await createRunService(store).executeRun(first, { signal: signal() });
        expect(result.evaluation?.passed).toBe(true);
        expect(result.experiment.output?.text).toBe(scenario.fakeByKind.single.primary.at(-1)!.type === "text" ? (scenario.fakeByKind.single.primary.at(-1) as { text: string }).text : "");
        const toolNames = result.events.filter((event) => event.type === "tool.completed").map((event) => event.toolName);
        const expectedCalls = scenario.fakeByKind.single.primary.filter((response) => response.type === "tool_call");
        expect(toolNames).toEqual(expectedCalls.map((response) => response.call.toolName));
        const continuation = requests.at(-1)!.messages.filter((message) => message.role === "tool");
        for (const [index, response] of expectedCalls.entries()) {
          const expected = response.call.toolName === "document_search"
            ? await new DocumentSearchTool().execute(response.call.arguments)
            : await new CalculatorTool().execute(response.call.arguments);
          expect(continuation[index]).toMatchObject({ output: expected });
        }
        expect(requests.every((request) => request.tools.map((tool) => tool.name).join(",") === "document_search,calculator")).toBe(true);
        expect(result.events.filter((event) => event.type === "scenario.evaluated")).toHaveLength(1);
        expect(result.events.filter((event) => ["experiment.completed", "experiment.failed"].includes(event.type))).toHaveLength(1);
        expect(append).toHaveBeenCalledOnce();
        const [record] = await store.readAll();
        expect(record.schemaVersion).toBe(3);
        expect(record.events).toEqual(result.events);
        expect(record.output).toEqual(result.experiment.output);
        await expect(new ExperimentHistoryStore(store.filePath).readAll()).resolves.toEqual([record]);
        expect(providers[0]).not.toBe(providers[1]);
        expect((await createRunService({ append: async () => {} }).executeRun(second, { signal: signal() })).evaluation?.passed).toBe(true);
      } finally { await rm(directory, { recursive: true, force: true }); }
    });

    it(`${scenario.id}/${configurationId}: separates completed/FAIL from execution failure`, async () => {
      const fake = new FakeModelProvider([...scenario.fakeByKind.single.primary.slice(0, -1), { type: "text", text: "RESULT incorrect=value" }]);
      const result = await createRunService({ append: async () => {} }).executeRun(prepareRun({ task: scenario.task, scenarioId: scenario.id }, { configurationId, providerFor: () => fake }), { signal: signal() });
      expect(result.experiment.status).toBe("completed");
      expect(result.experiment.failureCode).toBeUndefined();
      expect(result.evaluation).toEqual({ passed: false, reason: "Document scenario failed: result format." });
    });
  }

  it("does not retain private tool inputs/outputs in events, logs or history while preserving final content", async () => {
    const query = "privatequerysentinelunique";
    const output = "privateresultsentinelunique";
    const tools = createTools(["document_search", "calculator"]);
    vi.spyOn(TOOL_FACTORIES, "document_search").mockImplementation(() => {
      const search = tools[0];
      search.execute = async () => output;
      return search as DocumentSearchTool;
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const append = vi.fn().mockResolvedValue(undefined);
    for (const final of ["Public final", output]) {
      const provider = new FakeModelProvider([
        { type: "tool_call", call: { callId: "sentinel", toolName: "document_search", arguments: { query } } },
        { type: "text", text: final },
      ]);
      const result = await createRunService({ append }).executeRun(prepareRun({ task: "Public task", scenarioId: "document-conflict-v1" }, { providerFor: () => provider }), { signal: signal() });
      expect(JSON.stringify(result.events.filter((event) => /^(tool|model)\./.test(event.type)))).not.toMatch(new RegExp(`${query}|${output}`));
      const record = append.mock.calls.at(-1)![0];
      expect(JSON.stringify(record)).not.toContain(query);
      expect(record.output.text).toBe(final);
      if (final !== output) expect(JSON.stringify(record)).not.toContain(output);
    }
    expect(JSON.stringify(log.mock.calls)).not.toMatch(new RegExp(`${query}|${output}`));
  });
});

for (const scenario of scenarios) describe(`${scenario.id} evaluator`, () => {
  const final = (scenario.fakeByKind.single.primary.at(-1) as { text: string }).text;
  const names = scenario.fakeByKind.single.primary.filter((response) => response.type === "tool_call").map((response) => response.call.toolName);
  const experiment: Experiment = { id: "test", task: scenario.task, startedAt: "2026-10-16T00:00:00.000Z", status: "completed", output: { type: "text", text: final } };
  const base = { experimentId: experiment.id, occurredAt: experiment.startedAt };
  const events: ExperimentEvent[] = [{ ...base, type: "model.requested", purpose: "initial" }, ...names.flatMap((toolName): ExperimentEvent[] => [
    { ...base, type: "tool.started", toolName }, { ...base, type: "tool.completed", toolName },
  ])];
  const evaluate = (text = final, changes: Partial<Experiment> = {}, signals = events) => scenario.evaluate({ ...experiment, output: { type: "text", text }, ...changes }, signals);
  it.each([final, `Brief explanation\n${final}`, `Key points\nEvidence found\nConclusion\n${final}\n`, final.replace(/sources=([^,]+),([^;]+)/, "sources=$2,$1")])("accepts correct fields with free explanation: %s", (text) => {
    expect(evaluate(text).passed).toBe(true);
  });
  it.each(["", `${final}\nExtra`, `${final}\n${final}`, `\`\`\`text\n${final}\n\`\`\``, `~~~\n${final}\n~~~`, final + "; extra=1", final + "; sources=duplicate", final.replace("sources=", "Sources="), final.replace(/sources=.*/, "sources="), final.replace(/sources=.*/, "sources=wrong-id"), final.replace(/sources=([^,]+),.*/, "sources=$1,$1"), final.replace(/sources=([^,]+),.*/, "sources=$1"), "x".repeat(8193) + "\n" + final])("rejects malformed or incorrect result: %s", (text) => {
    expect(evaluate(text).passed).toBe(false);
  });
  it("rejects incorrect values even if the correct result appears in explanation", () => {
    const wrong = final.replace(/=(dock-r2|14|161)/, "=999");
    expect(evaluate(`Correct explanation: ${final}\n${wrong}`).reason).toContain("result value");
    for (const value of ["014", "14.0", "+14", "140"]) {
      if (scenario.id === "document-conflict-v1") expect(evaluate(final.replace("days=14;", `days=${value};`)).passed).toBe(false);
    }
  });
  it("rejects failure, malformed lifecycle, wrong IDs, skipped models and scoped/handoff signals", () => {
    expect(evaluate(final, { status: "failed", failureCode: "cancelled" }).reason).toContain("completion");
    expect(evaluate(final, { output: undefined }).passed).toBe(false);
    const variants: ExperimentEvent[][] = [[], events.slice(1), events.slice(0, -1),
      [...events, { ...base, type: "tool.failed", toolName: "document_search" }],
      [...events, { ...base, type: "tool.completed", toolName: "calculator" }],
      [...events, { ...base, type: "tool.started", toolName: "calculator" }],
      [...events, { ...base, type: "model.skipped", reason: "deterministic_arithmetic" }],
      [...events, { ...base, type: "handoff.completed", fromAgentId: "analyst", toAgentId: "finalizer" }],
      events.map((event) => ({ ...event, experimentId: "foreign" })),
      events.map((event) => event.type === "tool.started" ? { ...event, agentId: "analyst" } : event),
      [events[0], events[1], events[1], ...events.slice(2)],
      events.map((event) => event.type === "tool.completed" ? { ...event, toolName: "wrong" } : event),
    ];
    if (scenario.id === "document-calculation-v1") variants.push([events[0], ...events.slice(3), ...events.slice(1, 3)]);
    for (const variant of variants) expect(evaluate(final, {}, variant).passed).toBe(false);
  });
});
