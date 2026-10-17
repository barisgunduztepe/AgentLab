import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createExperimentPostHandler } from "./experiment-post-handler";
import { FakeModelProvider } from "../../../agent/providers/fake-model-provider";
import { abortableDelay } from "../../../agent/cancellation";
import type { SingleRunFrame } from "../../../experiments/single-run-types";
import type { ExperimentHistoryRecord } from "../../../experiments/experiment-history";

beforeEach(() => vi.stubEnv("AGENTLAB_MODEL_PROVIDER", "fake"));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const body = { scenarioId: "document-calculation-v1", runVersion: 2, configurationId: "single-critic-audit-v1" };
const request = (value: unknown, signal?: AbortSignal) => new Request("http://localhost/api/experiments", { method: "POST", body: JSON.stringify(value), signal });
const decode = (raw: string): SingleRunFrame[] => raw.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));

it.each([
  { ...body, runVersion: 3 }, { ...body, runVersion: undefined }, { ...body, configurationId: "handoff-default" },
  { ...body, configurationId: "missing" }, { ...body, scenarioId: "direct-text" },
  { task: "Custom", runVersion: 2, configurationId: "single-critic-audit-v1" },
])("rejects invalid single opt-in before execution: %j", async (value) => {
  const append = vi.fn(); expect((await createExperimentPostHandler({ append })(request(value))).status).toBe(400);
  expect(append).not.toHaveBeenCalled();
});

it("keeps legacy events and explicitly wraps V2 audit/terminal DTO without persisting it", async () => {
  const append = vi.fn().mockResolvedValue(undefined); const handler = createExperimentPostHandler({ append });
  const legacy = await (await handler(request({ scenarioId: body.scenarioId }))).text();
  expect(legacy).not.toContain('"run.'); expect(legacy).not.toContain('"audit"');
  const frames = decode(await (await handler(request(body))).text());
  expect(frames[0]).toMatchObject({ type: "run.started", run: { provider: "fake", architecture: "single-critic" } });
  const last = frames.at(-1);
  expect(last).toMatchObject({ type: "run.finished", result: { historySaved: true, experiment: { status: "completed" }, evaluation: { passed: true }, audit: { status: "completed", criticModelCalls: 1 }, metrics: { modelRequested: 5, toolCompleted: 3, unknownUsageCalls: 5 } } });
  expect(append).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(append.mock.calls)).not.toContain('"audit"');
  if (last?.type !== "run.finished") throw new Error("Missing terminal");
  expect(frames.flatMap((f) => f.type === "run.event" ? [f.event] : [])).toEqual(append.mock.calls[1][0].events);
  expect(frames.filter((f) => f.type === "run.audit").at(-1)).toEqual({ type: "run.audit", audit: last.result.audit });
});

it.each(["request-abort", "reader-cancel"])("cancels a pending Critic on %s and persists exactly one cancelled terminal", async (mode) => {
  const original = FakeModelProvider.prototype.complete;
  let entered!: () => void; const pending = new Promise<void>((resolve) => { entered = resolve; });
  vi.spyOn(FakeModelProvider.prototype, "complete").mockImplementation(async function (this: FakeModelProvider, req) {
    if (req.tools.length === 0) { entered(); await abortableDelay(60_000, req.signal); }
    return original.call(this, req);
  });
  let saved!: () => void; const persisted = new Promise<void>((resolve) => { saved = resolve; });
  const append = vi.fn(async (record: ExperimentHistoryRecord) => { expect(record.schemaVersion).toBe(3); saved(); }); const controller = new AbortController();
  const response = await createExperimentPostHandler({ append })(request(body, controller.signal));
  await pending;
  if (mode === "request-abort") controller.abort(); else await response.body!.cancel();
  await persisted;
  expect(append).toHaveBeenCalledOnce();
  expect(append.mock.calls[0][0].events.filter((e: { type: string }) => ["experiment.completed", "experiment.failed"].includes(e.type))).toEqual([expect.objectContaining({ type: "experiment.failed", failureCode: "cancelled" })]);
  expect(JSON.stringify(append.mock.calls)).not.toContain('"audit"');
});
