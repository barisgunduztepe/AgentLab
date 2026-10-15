import { experimentHistoryStore, type ExperimentHistoryStore } from "../../../../experiments/experiment-history";
import { createComparisonService, prepareComparison, type ComparisonOptions } from "../../../../experiments/comparison-service";
import { RunRequestError } from "../../../../experiments/run-service";
import { streamResponse } from "../stream-response";
import { wantsEventStream } from "./wants-event-stream";
export function createComparisonPostHandler(history: Pick<ExperimentHistoryStore, "append">, options: ComparisonOptions = {}) {
  const service = createComparisonService(history);
  return async function handleComparisonPost(request: Request): Promise<Response> {
    let body: unknown;
    try { body = await request.json(); } catch { return Response.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
    let plan: ReturnType<typeof prepareComparison>;
    try { plan = prepareComparison(body, options); } catch (error) {
      return Response.json({ error: error instanceof RunRequestError ? error.message : "Experiment provider is not configured." }, { status: error instanceof RunRequestError ? 400 : 500 });
    }
    if (wantsEventStream(request.headers.get("Accept"))) return streamResponse(request, (signal, send) => service.execute(plan, signal, send), true);
    return Response.json(await service.execute(plan, request.signal), { headers: { Vary: "Accept" } });
  };
}
export const handleComparisonPost = createComparisonPostHandler(experimentHistoryStore);
