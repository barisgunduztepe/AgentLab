import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { abortableDelay } from "../agent/cancellation";
import { createRunService, prepareRun, resolveSelection } from "./run-service";
import type { ExperimentHistoryRecord } from "./experiment-history";

beforeEach(() => vi.stubEnv("AGENTLAB_MODEL_PROVIDER", "fake"));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("shared run service", () => {
  it("captures isolated events, evaluates and persists exactly once after terminal", async () => {
    const append = vi.fn(async (record: ExperimentHistoryRecord) => { expect(record.events.at(-1)?.type).toBe("scenario.evaluated"); });
    const plan = prepareRun(resolveSelection({ scenarioId: "calculator-once" }));
    const evaluator = vi.fn(plan.evaluate!); plan.evaluate = evaluator;
    const result = await createRunService({ append }).executeRun(plan, { signal: new AbortController().signal,
      onEvent: (event) => { event.experimentId = "tampered"; } });
    expect(result.historySaved).toBe(true); expect(evaluator).toHaveBeenCalledOnce(); expect(append).toHaveBeenCalledOnce();
    expect(result.events.every((e) => e.experimentId === result.experiment.id)).toBe(true);
    expect(result.events.filter((e) => e.type === "experiment.completed" || e.type === "experiment.failed")).toHaveLength(1);
    await expect(createRunService({ append }).executeRun(plan, { signal: new AbortController().signal })).rejects.toThrow("already consumed");
    expect(append).toHaveBeenCalledOnce();
  });
  it("does not let evaluator failure bypass persistence or rewrite a completed experiment", async () => {
    const plan = prepareRun(resolveSelection({ scenarioId: "direct-text" }));
    plan.evaluate = () => { throw new Error("private evaluation"); };
    const append = vi.fn().mockResolvedValue(undefined);
    const result = await createRunService({ append }).executeRun(plan, { signal: new AbortController().signal });
    expect(result.experiment.status).toBe("completed"); expect(result.evaluation?.passed).toBe(false);
    expect(append).toHaveBeenCalledOnce(); expect(JSON.stringify(result)).not.toContain("private evaluation");
  });
  it("keeps the terminal outcome when cancellation arrives during persistence", async () => {
    const controller = new AbortController();
    const result = await createRunService({ append: async () => { controller.abort(); } }).executeRun(prepareRun({ task: "Explain" }), { signal: controller.signal });
    expect(result.experiment.status).toBe("completed"); expect(result.historySaved).toBe(true);
  });
  it("reports a history failure without retrying the model or append", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const append = vi.fn().mockRejectedValue(new Error("private path"));
    const result = await createRunService({ append }).executeRun(prepareRun({ task: "Explain" }), { signal: new AbortController().signal });
    expect(result.experiment.status).toBe("completed"); expect(result.historySaved).toBe(false);
    expect(append).toHaveBeenCalledOnce(); expect(result.events.filter((e) => e.type === "model.requested")).toHaveLength(1);
  });
  it("aborts a pending provider after observer failure and still saves one cancelled terminal", async () => {
    const complete = vi.fn(async (request) => { await abortableDelay(60000, request.signal); return { type: "text" as const, text: "late", finishReason: "stop" as const, usage: null }; });
    const plan = prepareRun({ task: "Explain" }, { providerFor: () => ({ complete }) });
    const append = vi.fn().mockResolvedValue(undefined);
    const result = await createRunService({ append }).executeRun(plan, { signal: new AbortController().signal,
      onEvent: (event) => { if (event.type === "model.requested") throw new Error("private observer"); } });
    expect(result.experiment.failureCode).toBe("cancelled"); expect(append).toHaveBeenCalledOnce();
    expect(result.events.filter((e) => e.type === "experiment.failed")).toHaveLength(1);
    expect(result.events.some((e) => e.type === "experiment.completed")).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private observer");
  });
  it("records an admitted single run cancelled before model execution", async () => {
    const controller = new AbortController(); controller.abort(); const append = vi.fn().mockResolvedValue(undefined);
    const result = await createRunService({ append }).executeRun(prepareRun({ task: "Explain" }), { signal: controller.signal });
    expect(result.experiment.failureCode).toBe("cancelled"); expect(append).toHaveBeenCalledOnce();
    expect(result.events.some((e) => e.type === "model.requested")).toBe(false);
  });
});
