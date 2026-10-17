import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FakeModelProvider } from "../agent/providers/fake-model-provider";
import { prepareComparison, createComparisonService } from "./comparison-service";
import type { ComparisonFrame } from "./comparison-types";
import { comparisonMetrics } from "./comparison-metrics";
import { createComparisonPostHandler } from "../app/api/experiments/compare/comparison-post-handler";
import { GET } from "../app/api/experiments/route";
import { publicCatalog } from "./catalog";

beforeEach(() => vi.stubEnv("AGENTLAB_MODEL_PROVIDER", "fake"));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const ids = ["baseline", "structured", "single-critic-audit-v1"];
const body = { scenarioId: "document-conflict-v1", comparisonVersion: 2, configurationIds: ids };
const signal = () => new AbortController().signal;
const request = (value: unknown, stream = false) => new Request("http://localhost/api/experiments/compare", { method: "POST", body: JSON.stringify(value), headers: stream ? { Accept: "text/event-stream" } : {} });

it.each([
  { ...body, configurationIds: [] }, { ...body, configurationIds: ["baseline"] },
  { ...body, configurationIds: [...ids, "baseline", "structured"] },
  { ...body, configurationIds: ["baseline", "baseline"] },
  { ...body, configurationIds: ["baseline", "missing"] },
  { ...body, configurationIds: ["baseline", "handoff-default"] },
  { ...body, scenarioId: "direct-text" }, { ...body, comparisonVersion: 3 },
  { ...body, comparisonVersion: 1 }, { ...body, comparisonVersion: undefined },
  { ...body, configurationIds: null }, { ...body, scenarioId: "missing" },
])("rejects invalid V2 before provider creation or append: %j", async (value) => {
  const append = vi.fn(); const createProviderFor = vi.fn();
  expect((await createComparisonPostHandler({ append }, { createProviderFor })(request(value))).status).toBe(400);
  expect(createProviderFor).not.toHaveBeenCalled(); expect(append).not.toHaveBeenCalled();
});

it("keeps legacy catalog and JSON keys while exposing V2 only on opt-in", async () => {
  const legacy = publicCatalog();
  expect(legacy).not.toHaveProperty("comparisonVersion");
  expect(legacy.scenarios[5].comparisonConfigurations.map((x) => x.id)).toEqual(ids.slice(0, 2));
  expect((await (await GET(new Request("http://localhost/api/experiments?comparisonVersion=2"))).json()).scenarios[5].comparisonConfigurations.map((x: { id: string }) => x.id)).toEqual(ids);
  expect(GET(new Request("http://localhost/api/experiments?comparisonVersion=3")).status).toBe(400);
  const result = await createComparisonService({ append: async () => {} }).execute(prepareComparison({ scenarioId: body.scenarioId }), signal());
  expect(Object.keys(result).sort()).toEqual(["comparisonId", "scenarioId", "runs"].sort());
  for (const row of result.runs) expect(Object.keys(row).sort()).toEqual(["configurationId", "id", "status", "run", "durationMs", "output", "evaluation", "historySaved"].sort());
});

it.each([2, 3])("runs %i ordered selections with independent slot fixtures and identical terminal SSE/JSON audit DTOs", async (size) => {
  const selected = ids.slice(0, size).reverse();
  const slots: string[] = []; const providers: FakeModelProvider[] = [];
  const append = vi.fn().mockResolvedValue(undefined); const frames: ComparisonFrame[] = [];
  const plan = prepareComparison({ ...body, configurationIds: selected }, { createProviderFor: (id, slot, responses) => {
    slots.push(`${id}/${slot}`); const provider = new FakeModelProvider(responses); providers.push(provider); return provider;
  } });
  const result = await createComparisonService({ append }).execute(plan, signal(), (f) => frames.push(f));
  expect(result.runs.map((r) => r.configurationId)).toEqual(selected);
  expect(result.runs.every((r) => r.evaluation?.passed)).toBe(true);
  expect(new Set(providers).size).toBe(size === 3 ? 4 : 2);
  if (size === 3) {
    expect(slots.slice(0, 2)).toEqual([`${ids[2]}/producer`, `${ids[2]}/critic`]);
    expect(result.runs[0].audit?.report?.verdict).toBe("no_issue");
  }
  expect(frames.at(-1)).toEqual({ type: "comparison.finished", outcome: "completed", result });
  expect(append).toHaveBeenCalledTimes(size);
  expect(JSON.stringify(append.mock.calls)).not.toContain('"audit"');
  for (const row of result.runs) {
    const events = frames.flatMap((f) => f.type === "comparison.event" && f.configurationId === row.configurationId ? [f.event] : []);
    expect(row.metrics).toEqual(comparisonMetrics(events));
    expect(row.metrics?.unknownUsageCalls).toBe(row.metrics?.modelResponded);
    expect(row.metrics?.knownTokens.total).toBeNull();
  }
  const handler = createComparisonPostHandler({ append: async () => {} });
  const json = await (await handler(request({ ...body, configurationIds: selected }))).json();
  const raw = await (await handler(request({ ...body, configurationIds: selected }, true))).text();
  const terminal = raw.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6))).at(-1);
  expect(terminal.result.runs.map((r: { audit?: unknown }) => r.audit)).toEqual(json.runs.map((r: { audit?: unknown }) => r.audit));
});

it("supports four sequential coordinator slots without inventing a fourth production architecture", async () => {
  const plan = prepareComparison(body);
  // Admission remains restricted to the three registered configurations. Exercise
  // the coordinator's fourth slot with an independent already-valid test plan.
  plan.plans.push(prepareComparison(body).plans[0]);
  const append = vi.fn().mockResolvedValue(undefined);
  const result = await createComparisonService({ append }).execute(plan, signal());
  expect(result.runs).toHaveLength(4); expect(append).toHaveBeenCalledTimes(4);
  expect(new Set(result.runs.map((r) => r.id)).size).toBe(4);
});

it("continues after invalid audit and append failure, without retry", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const append = vi.fn().mockRejectedValueOnce(new Error("private-path")).mockResolvedValue(undefined);
  const plan = prepareComparison({ ...body, configurationIds: [ids[2], ids[0], ids[1]] }, { createProviderFor: (_id, slot, responses) => new FakeModelProvider(slot === "critic" ? [{ type: "text", text: "invalid-private-report" }] : responses) });
  const result = await createComparisonService({ append }).execute(plan, signal());
  expect(result.runs.map((r) => r.status)).toEqual(["failed", "completed", "completed"]);
  expect(result.runs[0]).toMatchObject({ audit: { status: "invalid_report" }, failureCode: "unknown", historySaved: false });
  expect(append).toHaveBeenCalledTimes(3); expect(JSON.stringify(result)).not.toContain("invalid-private-report");
});

it.each(["abort", "observer"])("stops at Critic boundary on %s; queued rows have no ID/history", async (mode) => {
  const controller = new AbortController(); const append = vi.fn().mockResolvedValue(undefined);
  const plan = prepareComparison({ ...body, configurationIds: [ids[2], ids[0], ids[1]] });
  const frames: ComparisonFrame[] = [];
  const result = await createComparisonService({ append }).execute(plan, controller.signal, (f) => {
    frames.push(f);
    if (f.type === "comparison.audit" && f.audit.phase === "critic" && f.audit.status === "running") {
      if (mode === "abort") controller.abort(); else throw new Error("disconnect");
    }
  });
  expect(result.runs).toHaveLength(1); expect(append).toHaveBeenCalledOnce();
  expect(result.runs[0]).toMatchObject({ failureCode: "cancelled", audit: { status: "cancelled", criticModelCalls: 0 } });
  expect(plan.plans.slice(1).every((p) => !p.consumed)).toBe(true);
});

it("counts partial known token subtotals separately from unknown usage calls", () => {
  const base = { experimentId: "m", occurredAt: "now", type: "model.responded" as const, outcome: "text" as const, durationMs: 0 };
  expect(comparisonMetrics([{ ...base, usage: null }, { ...base, usage: { inputTokens: 0, outputTokens: 7, totalTokens: null } }, { ...base, usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } }])).toMatchObject({ knownTokens: { input: 2, output: 10, total: 5 }, unknownUsageCalls: 2 });
});
