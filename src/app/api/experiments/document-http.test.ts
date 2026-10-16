import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createExperimentPostHandler } from "./experiment-post-handler";
import { createComparisonPostHandler } from "./compare/comparison-post-handler";
import { readEventStream } from "../../experiment-stream";
import type { ExperimentHistoryRecord } from "../../../experiments/experiment-history";
import type { ExperimentEvent } from "../../../experiments/types";
import type { ComparisonFrame } from "../../../experiments/comparison-types";
import { abortableDelay } from "../../../agent/cancellation";

beforeEach(() => vi.stubEnv("AGENTLAB_MODEL_PROVIDER", "fake"));
afterEach(() => vi.unstubAllEnvs());
const ids = ["document-chain-v1", "document-conflict-v1", "document-calculation-v1"];
const request = (scenarioId: string, sse = true) => new Request("http://localhost/api/experiments", {
  method: "POST", headers: sse ? { Accept: "text/event-stream" } : {}, body: JSON.stringify({ scenarioId }),
});

it.each(ids)("%s: single SSE preserves evaluated events in history", async (id) => {
  const records: ExperimentHistoryRecord[] = [];
  const events: ExperimentEvent[] = [];
  const response = await createExperimentPostHandler({ append: async (record) => { records.push(record); } })(request(id));
  await readEventStream<ExperimentEvent>(response, new AbortController().signal, (event) => events.push(event));
  expect(records).toHaveLength(1);
  expect(records[0].events).toEqual(events);
  expect(records[0].evaluation?.passed).toBe(true);
  expect(records[0].schemaVersion).toBe(3);
});

for (const id of ids) it.each([true, false])(`${id}: compare SSE=%s keeps two isolated records`, async (sse) => {
  const records: ExperimentHistoryRecord[] = [];
  const response = await createComparisonPostHandler({ append: async (record) => { records.push(record); } })(request(id, sse));
  const frames: ComparisonFrame[] = [];
  if (sse) await readEventStream<ComparisonFrame>(response, new AbortController().signal, (frame) => frames.push(frame));
  else expect((await response.json()).runs).toHaveLength(2);
  expect(records).toHaveLength(2);
  expect(records[0].id).not.toBe(records[1].id);
  expect(records.map((record) => record.run?.agentConfigurationId)).toEqual(["baseline", "structured"]);
  for (const record of records) {
    expect(record.evaluation?.passed).toBe(true);
    expect(record.run).toMatchObject({ provider: "fake", agentConfigurationVersion: 1 });
    if (sse) expect(frames.filter((frame) => frame.type === "comparison.event" && frame.event.experimentId === record.id)
      .map((frame) => frame.type === "comparison.event" && frame.event)).toEqual(record.events);
  }
});

it.each(["reader", "request"])("new mixed scenario cancellation via %s saves only the first failed run", async (mode) => {
  const records: ExperimentHistoryRecord[] = [];
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const second = vi.fn();
  const controller = new AbortController();
  const handler = createComparisonPostHandler({ append: async (record) => { records.push(record); } }, {
    createProviders: () => [{ complete: async (req) => {
      entered(); await abortableDelay(60000, req.signal);
      return { type: "text", text: "late", finishReason: "stop", usage: null };
    } }, { complete: second }],
  });
  const original = request(ids[2]);
  const response = await handler(new Request(original, { signal: controller.signal }));
  const reader = response.body!.getReader();
  await reader.read(); await started;
  if (mode === "reader") await reader.cancel(); else controller.abort();
  await vi.waitFor(() => expect(records).toHaveLength(1));
  expect(records[0].events.filter((event) => event.type === "experiment.failed")).toEqual([expect.objectContaining({ failureCode: "cancelled" })]);
  expect(records[0].evaluation?.passed).toBe(false);
  expect(second).not.toHaveBeenCalled();
  if (mode === "request") await reader.cancel();
});
