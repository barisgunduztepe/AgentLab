import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FakeModelProvider } from "../agent/providers/fake-model-provider";
import type { AuditProgress } from "../agent/critic-report";
import { ExperimentHistoryStore } from "./experiment-history";
import { createRunService, prepareRun } from "./run-service";
import { SCENARIOS, comparisonConfigurations } from "./scenarios";

beforeEach(() => vi.stubEnv("AGENTLAB_MODEL_PROVIDER", "fake"));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const configurationId = "single-critic-audit-v1";
const signal = () => new AbortController().signal;

it.each(SCENARIOS.slice(5))("$id: integrates independent slots, audit-only output and history v3", async (scenario) => {
  const directory = await mkdtemp(join(tmpdir(), "agentlab-audit-"));
  try {
    const store = new ExperimentHistoryStore(join(directory, "history.json"));
    const audit: AuditProgress[] = [];
    const result = await createRunService(store).executeRun(prepareRun({ task: scenario.task, scenarioId: scenario.id }, { configurationId }), { signal: signal(), onAudit: (p) => audit.push(p) });
    expect(result.experiment.status).toBe("completed");
    expect(result.evaluation?.passed).toBe(true);
    expect(result.audit?.report?.verdict).toBe("no_issue");
    expect(audit.at(-1)).toEqual(result.audit);
    expect(result.events.filter((e) => e.type === "model.requested").length).toBeLessThanOrEqual(5);
    expect(result.events.filter((e) => e.type === "tool.completed").length).toBeLessThanOrEqual(3);
    expect(result.events.every((e) => !("agentId" in e))).toBe(true);
    const baseline = await createRunService({ append: async () => {} }).executeRun(prepareRun({ task: scenario.task, scenarioId: scenario.id }), { signal: signal() });
    expect(result.experiment.output).toEqual(baseline.experiment.output);
    const [record] = await store.readAll();
    expect(record.schemaVersion).toBe(3);
    expect(record.run).toMatchObject({ architecture: "single-critic", agentConfigurationId: configurationId, agentConfigurationVersion: 1 });
    expect(JSON.stringify(record)).not.toContain('"report"');
    expect(JSON.stringify(record)).not.toContain('"audit"');
    expect(comparisonConfigurations(scenario)).toEqual(["baseline", "structured"]);
    expect(comparisonConfigurations(scenario, 2)).toEqual(["baseline", "structured", configurationId]);
    await expect(new ExperimentHistoryStore(store.filePath).readAll()).resolves.toEqual([record]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it("never persists a transient issue and keeps evaluator PASS independent of verdict", async () => {
  const scenario = SCENARIOS[5];
  const append = vi.fn().mockResolvedValue(undefined);
  const slots: string[] = [];
  const result = await createRunService({ append }).executeRun(prepareRun({ task: scenario.task, scenarioId: scenario.id }, {
    configurationId, providerFor(slot) {
      slots.push(slot);
      return new FakeModelProvider(slot === "producer" ? scenario.fakeByKind.single.primary : [{ type: "text", text: JSON.stringify({ verdict: "issues_found", issues: [{ kind: "evidence_gap", message: "transient-issue-sentinel", evidenceId: 1 }] }) }]);
    },
  }), { signal: signal(), onAudit: (p) => { if (p.report) p.report.issues.length = 0; } });
  expect(slots).toEqual(["producer", "critic"]);
  expect(result.evaluation?.passed).toBe(true);
  expect(result.audit?.report?.issues).toHaveLength(1);
  expect(JSON.stringify(append.mock.calls)).not.toContain("transient-issue-sentinel");
  expect(JSON.stringify(result.events)).not.toContain("transient-issue-sentinel");
});

it("invalid report fails safely once, without retry or raw text retention", async () => {
  const append = vi.fn().mockResolvedValue(undefined);
  const critic = new FakeModelProvider([{ type: "text", text: "private-invalid-sentinel" }]);
  const complete = vi.spyOn(critic, "complete");
  const scenario = SCENARIOS[5];
  const result = await createRunService({ append }).executeRun(prepareRun({ task: scenario.task, scenarioId: scenario.id }, { configurationId,
    providerFor: (slot) => slot === "critic" ? critic : new FakeModelProvider(scenario.fakeByKind.single.primary),
  }), { signal: signal() });
  expect(result.experiment.failureCode).toBe("unknown");
  expect(result.audit?.status).toBe("invalid_report");
  expect(result.evaluation?.passed).toBe(false);
  expect(complete).toHaveBeenCalledOnce();
  expect(append).toHaveBeenCalledOnce();
  expect(result.events.filter((e) => e.type === "experiment.failed")).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain("private-invalid-sentinel");
});

it.each([["no_issue"], { verdict: "no_issue" }, null, 1, true, ""])("invalid verdict %j fails once without rewriting the producer answer or evaluator", async (verdict) => {
  const scenario = SCENARIOS[5];
  const append = vi.fn().mockResolvedValue(undefined);
  const producer = new FakeModelProvider(scenario.fakeByKind.single.primary);
  const produce = vi.spyOn(producer, "complete");
  const critic = new FakeModelProvider([{ type: "text", text: JSON.stringify({ verdict, issues: [] }) }]);
  const audit = vi.spyOn(critic, "complete");
  const plan = prepareRun({ task: scenario.task, scenarioId: scenario.id }, { configurationId,
    providerFor: (slot) => slot === "critic" ? critic : producer });
  const evaluate = vi.fn(plan.evaluate!); plan.evaluate = evaluate;
  const result = await createRunService({ append }).executeRun(plan, { signal: signal() });
  expect(result.experiment).toMatchObject({ status: "failed", failureCode: "unknown" });
  expect(result.audit).toMatchObject({ status: "invalid_report", criticModelCalls: 1 });
  expect(result.audit?.report).toBeUndefined();
  expect(audit).toHaveBeenCalledOnce(); expect(append).toHaveBeenCalledOnce();
  expect(result.events.filter((e) => ["experiment.completed", "experiment.failed"].includes(e.type))).toEqual([expect.objectContaining({ type: "experiment.failed", failureCode: "unknown" })]);
  expect(evaluate).toHaveBeenCalledOnce();
  expect(result.evaluation).toEqual(scenario.evaluate(result.experiment, result.events.filter((e) => e.type !== "scenario.evaluated")));
  expect(result.evaluation?.passed).toBe(false); // Existing failed-run policy stays intact.
  const answer = scenario.fakeByKind.single.primary.at(-1)!;
  expect(await produce.mock.results.at(-1)!.value).toMatchObject(answer);
  const data = audit.mock.calls[0][0].messages[1];
  expect(data.role).toBe("user");
  if (data.role !== "user" || answer.type !== "text") throw new Error("Invalid fixture");
  expect(JSON.parse(data.text).producerAnswer).toBe(answer.text);
  expect(append.mock.calls[0][0].output).toBeUndefined();
});

it("audit observer disconnect cancels before Critic and still finalizes once", async () => {
  const append = vi.fn().mockResolvedValue(undefined);
  const critic = new FakeModelProvider([{ type: "text", text: '{"verdict":"no_issue","issues":[]}' }]);
  const complete = vi.spyOn(critic, "complete");
  const scenario = SCENARIOS[5];
  const result = await createRunService({ append }).executeRun(prepareRun({ task: scenario.task, scenarioId: scenario.id }, { configurationId,
    providerFor: (slot) => slot === "critic" ? critic : new FakeModelProvider(scenario.fakeByKind.single.primary),
  }), { signal: signal(), onAudit: (p) => { if (p.phase === "critic") throw new Error("disconnected"); } });
  expect(result.experiment.failureCode).toBe("cancelled");
  expect(result.audit?.status).toBe("cancelled");
  expect(complete).not.toHaveBeenCalled();
  expect(append).toHaveBeenCalledOnce();
  expect(result.events.filter((e) => e.type === "experiment.failed")).toHaveLength(1);
});
