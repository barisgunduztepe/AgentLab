import { experimentHistoryStore, type ExperimentHistoryStore } from "../../../experiments/experiment-history";
import { createRunService, prepareRun, resolveSelection, RunRequestError } from "../../../experiments/run-service";
import { streamResponse } from "./stream-response";
import { isRunConfigurationId } from "../../../agent/architecture-definitions";
import { getScenarioById, comparisonConfigurations } from "../../../experiments/scenarios";
import { comparisonMetrics } from "../../../experiments/comparison-metrics";
import type { SingleRunFrame } from "../../../experiments/single-run-types";
export function createExperimentPostHandler(history: Pick<ExperimentHistoryStore, "append">) {
  const service = createRunService(history);
  return async function handleExperimentPost(request: Request): Promise<Response> {
    let body: unknown;
    try { body = await request.json(); } catch { return Response.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
    try {
      const selection = resolveSelection(body);
      const payload = body as Record<string, unknown>;
      const version = payload.runVersion;
      if (version !== undefined && version !== 2) throw new RunRequestError("Unsupported runVersion.");
      if (selection.scenarioId && (getScenarioById(selection.scenarioId)?.minimumTransportVersion ?? 1) > (version === 2 ? 2 : 1)) throw new RunRequestError("This scenario requires runVersion:2.");
      if (version !== 2 && "configurationId" in payload) throw new RunRequestError("Configuration selection requires runVersion:2.");
      if (version === 2) {
        const scenario = selection.scenarioId ? getScenarioById(selection.scenarioId) : undefined;
        const id = payload.configurationId;
        if (!scenario || !isRunConfigurationId(id) || !comparisonConfigurations(scenario, 2).includes(id)) throw new RunRequestError("Select a compatible fixed scenario and configuration.");
        const plan = prepareRun(selection, { configurationId: id });
        return streamResponse<SingleRunFrame>(request, async (signal, send) => {
          send({ type: "run.started", run: plan.run });
          const { events, ...result } = await service.executeRun(plan, { signal,
            onEvent: (event) => send({ type: "run.event", event }), onAudit: (audit) => send({ type: "run.audit", audit }) });
          send({ type: "run.finished", result: { ...result, metrics: comparisonMetrics(events) } });
        });
      }
      const plan = prepareRun(selection);
      return streamResponse(request, (signal, onEvent) => service.executeRun(plan, { signal, onEvent }));
    } catch (error) {
      return Response.json({ error: error instanceof RunRequestError ? error.message : "Experiment provider is not configured." }, { status: error instanceof RunRequestError ? 400 : 500 });
    }
  };
}
export const handleExperimentPost = createExperimentPostHandler(experimentHistoryStore);
