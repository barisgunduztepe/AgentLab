import { experimentHistoryStore, type ExperimentHistoryStore } from "../../../experiments/experiment-history";
import { createRunService, prepareRun, resolveSelection, RunRequestError } from "../../../experiments/run-service";
import { streamResponse } from "./stream-response";
export function createExperimentPostHandler(history: Pick<ExperimentHistoryStore, "append">) {
  const service = createRunService(history);
  return async function handleExperimentPost(request: Request): Promise<Response> {
    let body: unknown;
    try { body = await request.json(); } catch { return Response.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
    try {
      const plan = prepareRun(resolveSelection(body));
      return streamResponse(request, (signal, onEvent) => service.executeRun(plan, { signal, onEvent }));
    } catch (error) {
      return Response.json({ error: error instanceof RunRequestError ? error.message : "Experiment provider is not configured." }, { status: error instanceof RunRequestError ? 400 : 500 });
    }
  };
}
export const handleExperimentPost = createExperimentPostHandler(experimentHistoryStore);
