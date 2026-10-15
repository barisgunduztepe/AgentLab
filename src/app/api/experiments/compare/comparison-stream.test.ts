import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createComparisonPostHandler } from "./comparison-post-handler";
import { readEventStream } from "../../../experiment-stream";
import { applyComparisonFrame, type ComparisonProgress } from "../../../comparison-progress";
import type { ComparisonFrame } from "../../../../experiments/comparison-types";
import { FakeModelProvider } from "../../../../agent/providers/fake-model-provider";
import { abortableDelay } from "../../../../agent/cancellation";
import type { ExperimentHistoryRecord } from "../../../../experiments/experiment-history";
beforeEach(() => vi.stubEnv("AGENTLAB_MODEL_PROVIDER", "fake"));
afterEach(() => vi.unstubAllEnvs());
const request = (signal?: AbortSignal) => new Request("http://localhost/api/experiments/compare", { method: "POST", headers: { Accept: "text/event-stream" }, body: JSON.stringify({ scenarioId: "direct-text" }), signal });
describe("live comparison stream", () => {
  it("streams distinct run events, persists before run.finished and ends with the JSON result", async () => {
    const records: ExperimentHistoryRecord[] = []; const frames: ComparisonFrame[] = [];
    const handler = createComparisonPostHandler({ append: async (record) => { records.push(record); } });
    const response = await handler(request());
    expect(response.headers.get("Content-Type")).toContain("text/event-stream"); expect(response.headers.get("Vary")).toBe("Accept");
    let progress: ComparisonProgress | null = null;
    await readEventStream<ComparisonFrame>(response, new AbortController().signal, (frame) => {
      frames.push(frame); progress = applyComparisonFrame(progress, frame);
      if (frame.type === "comparison.run.finished") expect(records.some((r) => r.id === frame.run.id)).toBe(true);
    });
    expect(records).toHaveLength(2);
    expect(records[0].id).not.toBe(records[1].id);
    for (const record of records) {
      expect(frames.filter((f) => f.type === "comparison.event" && f.event.experimentId === record.id).map((f) => f.type === "comparison.event" && f.event)).toEqual(record.events);
      expect(record.events.at(-1)?.type).toBe("scenario.evaluated");
    }
    const final = frames.at(-1); expect(final?.type).toBe("comparison.finished");
    if (final?.type === "comparison.finished") expect(final.result.runs.map((r) => r.id)).toEqual(records.map((r) => r.id));
    expect(progress).toMatchObject({ finished: true });
  });
  it.each(["reader", "request"] as const)("delivers progress before model resolution and cancels one terminal via %s", async (mode) => {
    const controller = new AbortController(); const records: ExperimentHistoryRecord[] = [];
    let entered!: () => void; const started = new Promise<void>((resolve) => { entered = resolve; });
    const first = vi.fn(async (req) => { entered(); await abortableDelay(60000, req.signal); return { type: "text" as const, text: "late", finishReason: "stop" as const, usage: null }; });
    const second = vi.fn();
    const handler = createComparisonPostHandler({ append: async (record) => { records.push(record); } }, { createProviders: () => [{ complete: first }, { complete: second }] });
    const response = await handler(request(controller.signal));
    const reader = response.body!.getReader(); const chunk = await reader.read();
    expect(new TextDecoder().decode(chunk.value)).toContain("comparison.started");
    await started;
    if (mode === "reader") await reader.cancel(); else controller.abort();
    await vi.waitFor(() => expect(records).toHaveLength(1));
    expect(first).toHaveBeenCalledOnce(); expect(second).not.toHaveBeenCalled();
    expect(records[0].events.filter((e) => e.type === "experiment.failed")).toEqual([expect.objectContaining({ failureCode: "cancelled" })]);
    expect(records[0].events.some((e) => e.type === "experiment.completed")).toBe(false);
    if (mode === "request") await reader.cancel();
  });
  it("waits for persistence and does not start the second run after late cancellation", async () => {
    const controller = new AbortController(); const second = vi.fn();
    const handler = createComparisonPostHandler({ append: async () => { controller.abort(); } }, { createProviders: () => [new FakeModelProvider([{ type: "text", text: "Done" }]), { complete: second }] });
    const response = await handler(request(controller.signal));
    await vi.waitFor(() => expect(controller.signal.aborted).toBe(true));
    await response.body!.cancel();
    expect(second).not.toHaveBeenCalled();
  });
});
