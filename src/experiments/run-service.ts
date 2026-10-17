import { ARCHITECTURE_DEFINITIONS, type RunConfigurationId } from "../agent/architecture-definitions";
import { createArchitectureRunner } from "../agent/architecture-registry";
import { createProviderContext } from "../agent/create-model-provider";
import type { ModelProvider } from "../agent/model-provider";
import type { AuditObserver, AuditProgress } from "../agent/critic-report";
import { createTools } from "../tools/tool-registry";
import { type ExperimentHistoryStore, type ExperimentRunMetadata } from "./experiment-history";
import { toExperimentHistoryRecord } from "./history-record";
import { getShortCommit } from "./run-metadata";
import { runExperiment, type ExperimentRunner } from "./run-experiment";
import { getScenarioById, type Scenario, type ScenarioEvaluator } from "./scenarios";
import type { Experiment, ExperimentEvent, EvaluationResult } from "./types";

export class RunRequestError extends Error {}
export type RunSelection = { task: string; scenarioId?: string };
export function resolveSelection(body: unknown): RunSelection {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new RunRequestError("A non-empty task string is required.");
  const payload = body as Record<string, unknown>;
  if ("task" in payload && "scenarioId" in payload) throw new RunRequestError("Provide either task or scenarioId, not both.");
  if ("scenarioId" in payload) {
    if (typeof payload.scenarioId !== "string" || !payload.scenarioId.trim()) throw new RunRequestError("A non-empty scenarioId string is required.");
    const scenario = getScenarioById(payload.scenarioId.trim());
    if (!scenario) throw new RunRequestError("Unknown scenario.");
    return { task: scenario.task, scenarioId: scenario.id };
  }
  if (typeof payload.task !== "string" || !payload.task.trim()) throw new RunRequestError("A non-empty task string is required.");
  return { task: payload.task.trim() };
}

export function createRunContext() { return { provider: createProviderContext(), commit: getShortCommit() }; }
export type RunContext = ReturnType<typeof createRunContext>;
export interface PreparedRun {
  task: string; scenarioId?: string; configurationId: RunConfigurationId;
  runner: ExperimentRunner; run: ExperimentRunMetadata; evaluate?: ScenarioEvaluator;
  comparison?: { comparisonId: string; configurationId: RunConfigurationId };
  consumed: boolean;
  audit?: { current?: AuditProgress; observe?: AuditObserver };
}
export interface RunResult {
  experiment: Experiment; run: ExperimentRunMetadata; scenarioId?: string;
  evaluation?: EvaluationResult; events: ExperimentEvent[]; historySaved: boolean;
  audit?: AuditProgress;
}
export function prepareRun(selection: RunSelection, options: {
  context?: RunContext; configurationId?: RunConfigurationId;
  providerFor?: (slot: string) => ModelProvider;
  comparisonId?: string;
} = {}): PreparedRun {
  const scenario: Scenario | undefined = selection.scenarioId ? getScenarioById(selection.scenarioId) : undefined;
  if (selection.scenarioId && !scenario) throw new RunRequestError("Unknown scenario.");
  const id = options.configurationId ?? scenario?.defaultConfigurationId ?? "baseline";
  const entry = ARCHITECTURE_DEFINITIONS[id];
  if (!entry.enabled || (scenario && !scenario.compatibleKinds.includes(entry.scenarioKind))) throw new RunRequestError("This scenario does not support this configuration.");
  const context = options.context ?? createRunContext();
  const audit: PreparedRun["audit"] = entry.audit ? {} : undefined;
  const runner = createArchitectureRunner(id, {
    createTools: () => createTools(scenario?.toolIds ?? ["calculator"]),
    createProviderFor(slot) {
      if (options.providerFor) return options.providerFor(slot);
      const responses = scenario?.fakeByKind[entry.scenarioKind]?.[slot];
      if (scenario && context.provider.description.provider === "fake" && !responses) throw new Error("Missing fake plan.");
      return context.provider.create(responses);
    },
    ...(audit ? { onAudit: (progress: AuditProgress) => {
      audit.current = structuredClone(progress);
      audit.observe?.(structuredClone(progress));
    } } : {}),
  });
  return { ...selection, task: scenario?.task ?? selection.task, configurationId: id, runner, consumed: false,
    ...(scenario?.evaluate ? { evaluate: scenario.evaluate } : {}),
    run: { ...context.provider.description, architecture: entry.architecture, agentConfigurationId: id,
      agentConfigurationVersion: entry.version, ...(context.commit ? { commit: context.commit } : {}) },
    ...(options.comparisonId ? { comparison: { comparisonId: options.comparisonId, configurationId: id } } : {}),
    ...(audit ? { audit } : {}),
  };
}

export function createRunService(history: Pick<ExperimentHistoryStore, "append">) {
  return { async executeRun(plan: PreparedRun, options: { signal: AbortSignal; onEvent?: (event: ExperimentEvent) => void; onAudit?: AuditObserver }): Promise<RunResult> {
    if (plan.consumed) throw new Error("Run plan was already consumed.");
    plan.consumed = true;
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) abort();
    const events: ExperimentEvent[] = [];
    let observer = options.onEvent;
    let auditObserver = options.onAudit;
    const disconnect = () => { observer = undefined; auditObserver = undefined; abort(); };
    if (plan.audit) plan.audit.observe = (progress) => {
      try { auditObserver?.(structuredClone(progress)); } catch { disconnect(); }
    };
    const publish = (event: ExperimentEvent) => {
      events.push(structuredClone(event));
      try { observer?.(structuredClone(event)); } catch { disconnect(); }
    };
    try {
      const experiment = await runExperiment(plan.task, plan.runner, publish, { signal: controller.signal });
      let evaluation: EvaluationResult | undefined;
      if (plan.evaluate && plan.scenarioId) {
        try { evaluation = plan.evaluate(structuredClone(experiment), structuredClone(events), { configurationId: plan.configurationId }); }
        catch { evaluation = { passed: false, reason: "Scenario evaluation could not be completed." }; }
        if (experiment.failureCode === "cancelled") evaluation = { ...evaluation, passed: false };
        publish({ experimentId: experiment.id, occurredAt: new Date().toISOString(), type: "scenario.evaluated", scenarioId: plan.scenarioId, evaluation });
      }
      let historySaved = false;
      try {
        await history.append(toExperimentHistoryRecord(experiment, plan.scenarioId, evaluation, events, plan.run, plan.comparison));
        historySaved = true;
      } catch { console.error("AgentLab experiment history could not be saved."); }
      return { experiment, run: plan.run, scenarioId: plan.scenarioId, evaluation, events, historySaved,
        ...(plan.audit?.current ? { audit: structuredClone(plan.audit.current) } : {}) };
    } finally {
      options.signal.removeEventListener("abort", abort);
      if (plan.audit) delete plan.audit.observe;
    }
  } };
}
