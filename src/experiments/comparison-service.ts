import { randomUUID } from "node:crypto";
import { ARCHITECTURE_DEFINITIONS, isRunConfigurationId, type RunConfigurationId } from "../agent/architecture-definitions";
import { comparisonMetrics } from "./comparison-metrics";
import type { FakeResponse } from "../agent/providers/fake-model-provider";
import type { ModelProvider } from "../agent/model-provider";
import { comparisonConfigurations, getScenarioById } from "./scenarios";
import { createRunContext, createRunService, prepareRun, RunRequestError, type RunResult } from "./run-service";
import type { ExperimentHistoryStore } from "./experiment-history";
import type { ComparisonFrame, ComparisonResult, ComparisonRunResult } from "./comparison-types";

export interface ComparisonOptions {
  createComparisonId?: () => string;
  createProviders?: (fixtures?: Partial<Record<RunConfigurationId, readonly FakeResponse[]>>) => ModelProvider[];
  createProviderFor?: (configurationId: RunConfigurationId, slot: string, responses?: readonly FakeResponse[]) => ModelProvider;
}
export function prepareComparison(body: unknown, options: ComparisonOptions = {}) {
  if (typeof body !== "object" || !body || Array.isArray(body) || typeof (body as Record<string, unknown>).scenarioId !== "string") throw new RunRequestError("A fixed scenarioId is required.");
  const payload = body as Record<string, unknown>;
  if (payload.comparisonVersion !== undefined && payload.comparisonVersion !== 2) throw new RunRequestError("Unsupported comparisonVersion.");
  const version = payload.comparisonVersion === 2 ? 2 : 1;
  const scenario = getScenarioById((payload.scenarioId as string).trim());
  if (!scenario) throw new RunRequestError("This scenario cannot be compared.");
  const available = comparisonConfigurations(scenario, version);
  let ids = available;
  if (version === 2) {
    const selected = payload.configurationIds;
    if (!Array.isArray(selected) || selected.length < 2 || selected.length > 4 || new Set(selected).size !== selected.length ||
        !selected.every((id): id is RunConfigurationId => isRunConfigurationId(id) && available.includes(id))) throw new RunRequestError("Select 2–4 unique compatible configurations.");
    ids = selected;
  } else if ("configurationIds" in payload || ids.length !== 2) throw new RunRequestError("This scenario cannot be compared without V2 opt-in.");
  const context = createRunContext();
  const comparisonId = options.createComparisonId?.() ?? randomUUID();
  const fixtures = version === 1 && context.provider.description.provider === "fake" ? Object.fromEntries(ids.map((id) => [id, scenario.fakeByKind[ARCHITECTURE_DEFINITIONS[id].scenarioKind].primary])) : undefined;
  // The old injection hook describes one-slot legacy runs only.
  const providers = version === 1 ? options.createProviders?.(fixtures) : undefined;
  return { comparisonId, scenarioId: scenario.id, version,
    plans: ids.map((id, index) => prepareRun({ task: scenario.task, scenarioId: scenario.id }, {
      context, configurationId: id, comparisonId,
      ...(options.createProviderFor ? { providerFor: (slot: string) => options.createProviderFor!(id, slot,
        context.provider.description.provider === "fake" ? scenario.fakeByKind[ARCHITECTURE_DEFINITIONS[id].scenarioKind]?.[slot] : undefined) } :
        providers ? { providerFor: () => { if (!providers[index]) throw new Error("Missing provider."); return providers[index]; } } : {}),
    })) };
}
export function createComparisonService(history: Pick<ExperimentHistoryStore, "append">) {
  const service = createRunService(history);
  return { async execute(plan: ReturnType<typeof prepareComparison>, signal: AbortSignal, publish?: (frame: ComparisonFrame) => void): Promise<ComparisonResult> {
    const result: ComparisonResult = { comparisonId: plan.comparisonId, scenarioId: plan.scenarioId, runs: [], ...(plan.version === 2 ? { comparisonVersion: 2 } : {}) };
    // A thrown observer must cancel execution without bypassing terminal history finalization.
    const controller = new AbortController(); const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
    let observer = publish;
    const send = (frame: ComparisonFrame) => { try { observer?.(structuredClone(frame)); } catch { observer = undefined; abort(); } };
    try {
      send({ type: "comparison.started", comparisonId: plan.comparisonId, scenarioId: plan.scenarioId,
        ...(plan.version === 2 ? { comparisonVersion: 2 } : {}),
        configurations: plan.plans.map((p) => ({ configurationId: p.configurationId, label: ARCHITECTURE_DEFINITIONS[p.configurationId].label, run: p.run })) });
      for (const runPlan of plan.plans) {
        if (controller.signal.aborted) break;
        const run = await service.executeRun(runPlan, { signal: controller.signal,
          ...(plan.version === 2 ? { onAudit: (audit) => send({ type: "comparison.audit", comparisonId: plan.comparisonId, configurationId: runPlan.configurationId, audit }) } : {}),
          onEvent: (event) => send({ type: "comparison.event", comparisonId: plan.comparisonId, configurationId: runPlan.configurationId, event }) });
        const summary = summarize(runPlan.configurationId, run, plan.version);
        result.runs.push(summary);
        send({ type: "comparison.run.finished", comparisonId: plan.comparisonId, run: summary });
      }
      send({ type: "comparison.finished", outcome: controller.signal.aborted ? "cancelled" : "completed", result });
      return result;
    } finally { signal.removeEventListener("abort", abort); }
  } };
}
function summarize(configurationId: RunConfigurationId, value: RunResult, version: number): ComparisonRunResult {
  const { experiment: e, evaluation, historySaved, run } = value;
  return { configurationId, id: e.id, status: e.status === "running" ? "failed" : e.status, run,
    ...(e.durationMs === undefined ? {} : { durationMs: e.durationMs }),
    ...(e.status === "completed" && e.output ? { output: e.output } : {}),
    ...(e.status === "failed" && e.errorMessage ? { errorMessage: e.errorMessage } : {}),
    ...(evaluation ? { evaluation } : {}), historySaved,
    ...(version === 2 ? { metrics: comparisonMetrics(value.events), ...(e.failureCode ? { failureCode: e.failureCode } : {}), ...(value.audit ? { audit: value.audit } : {}) } : {}) };
}
