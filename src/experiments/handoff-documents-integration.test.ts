import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FakeModelProvider } from "../agent/providers/fake-model-provider";
import { abortableDelay } from "../agent/cancellation";
import { SCENARIOS, comparisonConfigurations } from "./scenarios";
import { publicCatalog } from "./catalog";
import { prepareRun } from "./run-service";
import { prepareComparison, createComparisonService } from "./comparison-service";
import { ExperimentHistoryStore } from "./experiment-history";
import type { ComparisonFrame } from "./comparison-types";
import { createComparisonPostHandler } from "../app/api/experiments/compare/comparison-post-handler";
import { createExperimentPostHandler } from "../app/api/experiments/experiment-post-handler";

beforeEach(() => vi.stubEnv("AGENTLAB_MODEL_PROVIDER", "fake"));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const ids = ["baseline", "structured", "single-critic-audit-v1", "handoff-documents-v1"];
const request = (body: unknown, stream = false, signal?: AbortSignal) => new Request("http://localhost/api/experiments", { method: "POST", body: JSON.stringify(body), headers: stream ? { Accept: "text/event-stream" } : {}, signal });
const decode = (text: string): ComparisonFrame[] => text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));

it("keeps the exact legacy catalog while V2 exposes three new four-way variants", () => {
  expect(createHash("sha256").update(JSON.stringify(publicCatalog())).digest("hex")).toBe("d9eaa2c368cdfbae892e3c8e8c238d13695a7839cd81275f8a55ed4e56614951");
  expect(publicCatalog(2).scenarios).toHaveLength(11);
  for (const [i, variant] of SCENARIOS.slice(8).entries()) {
    const original = SCENARIOS[i + 5];
    expect(variant.task).toBe(original.task); expect(variant.toolIds).toEqual(original.toolIds);
    expect(comparisonConfigurations(variant)).toEqual([]);
    expect(comparisonConfigurations(variant, 2)).toEqual(ids);
  }
  expect(() => prepareRun({ task: "", scenarioId: "analyst-finalizer-handoff" }, { configurationId: "handoff-documents-v1" })).toThrow();
  expect(() => prepareRun({ task: "", scenarioId: "document-chain-v1" }, { configurationId: "handoff-documents-v1" })).toThrow();
});

for (const scenario of SCENARIOS.slice(8)) {
  it(`${scenario.id}: rejects legacy requests before provider or append`, async () => {
    const complete = vi.spyOn(FakeModelProvider.prototype, "complete");
    const append = vi.fn(); const createProviderFor = vi.fn();
    expect((await createExperimentPostHandler({ append })(request({ scenarioId: scenario.id }))).status).toBe(400);
    expect((await createComparisonPostHandler({ append }, { createProviderFor })(request({ scenarioId: scenario.id }))).status).toBe(400);
    expect(createProviderFor).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled(); expect(append).not.toHaveBeenCalled();
  });
  it(`${scenario.id}: runs four independent configurations and roundtrips exact SSE events in history v3`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentlab-handoff-"));
    try {
      const store = new ExperimentHistoryStore(join(directory, "experiments.json"));
      const frames: ComparisonFrame[] = []; const slots: string[] = []; const providers: FakeModelProvider[] = [];
      const plan = prepareComparison({ scenarioId: scenario.id, comparisonVersion: 2, configurationIds: ids }, { createProviderFor: (id, slot, responses) => {
        slots.push(`${id}/${slot}`); const provider = new FakeModelProvider(responses); providers.push(provider); return provider;
      } });
      const result = await createComparisonService(store).execute(plan, new AbortController().signal, (f) => frames.push(f));
      expect(result.runs.every((row) => row.evaluation?.passed && row.historySaved)).toBe(true);
      expect(new Set(providers).size).toBe(6);
      expect(slots.at(-2)).toBe("handoff-documents-v1/analyst"); expect(slots.at(-1)).toBe("handoff-documents-v1/finalizer");
      const records = await store.readAll(); expect(records).toHaveLength(4);
      for (const row of result.runs) {
        const record = records.find((record) => record.id === row.id)!;
        expect(record.schemaVersion).toBe(3);
        expect(record.events).toEqual(frames.flatMap((f) => f.type === "comparison.event" && f.event.experimentId === row.id ? [f.event] : []));
        expect(record.events.filter((e) => e.type === "scenario.evaluated")).toHaveLength(1);
      }
      expect(await new ExperimentHistoryStore(store.filePath).readAll()).toEqual(records);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}

it.each([2, 3, 4])("supports %i selections and equivalent JSON/SSE behavioral DTOs", async (count) => {
  const selected = [...ids].reverse().slice(0, count);
  const body = { scenarioId: "document-chain-multi-v1", comparisonVersion: 2, configurationIds: selected };
  const handler = createComparisonPostHandler({ append: async () => {} });
  const json = await (await handler(request(body))).json();
  const last = decode(await (await handler(request(body, true))).text()).at(-1);
  if (last?.type !== "comparison.finished") throw new Error("Missing terminal");
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).filter(([k]) => !["id", "comparisonId", "durationMs"].includes(k)).map(([k, v]) => [k, stable(v)])) : value;
  expect(stable(json)).toEqual(stable(last.result));
  expect(json.runs.map((r: { configurationId: string }) => r.configurationId)).toEqual(selected);
});

it("admits a single V2 handoff and emits no audit report", async () => {
  const append = vi.fn().mockResolvedValue(undefined);
  const frames = decode(await (await createExperimentPostHandler({ append })(request({ scenarioId: "document-chain-multi-v1", runVersion: 2, configurationId: ids[3] }))).text());
  expect(frames.at(-1)).toMatchObject({ type: "run.finished", result: { evaluation: { passed: true }, experiment: { status: "completed" } } });
  expect(JSON.stringify(frames)).not.toContain('"run.audit"'); expect(append).toHaveBeenCalledOnce();
});

it.each(["abort", "observer"])("persists one cancellation during Finalizer on %s; next configuration remains unstarted", async (mode) => {
  const controller = new AbortController(); const append = vi.fn().mockResolvedValue(undefined);
  const entered: string[] = [];
  const plan = prepareComparison({ scenarioId: "document-chain-multi-v1", comparisonVersion: 2, configurationIds: [ids[3], ids[0]] }, {
    createProviderFor: (id, slot, responses) => {
      const fake = new FakeModelProvider(responses);
      return { complete: async (req) => {
        entered.push(`${id}/${slot}`);
        if (slot === "finalizer") await abortableDelay(60_000, req.signal);
        return fake.complete(req);
      } };
    },
  });
  const result = await createComparisonService({ append }).execute(plan, controller.signal, (frame) => {
    if (frame.type === "comparison.event" && frame.event.type === "model.requested" && frame.event.agentId === "finalizer") {
      if (mode === "abort") controller.abort(); else throw new Error("observer disconnected");
    }
  });
  expect(result.runs).toHaveLength(1); expect(result.runs[0].failureCode).toBe("cancelled");
  expect(append).toHaveBeenCalledOnce(); expect(plan.plans[1].consumed).toBe(false);
  expect(entered.some((slot) => slot.startsWith("baseline/"))).toBe(false);
});
