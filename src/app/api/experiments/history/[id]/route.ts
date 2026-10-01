import { experimentHistoryStore } from "../../../../../experiments/experiment-history";
import { createHistoryReadHandlers } from "../history-read-handlers";

const handlers = createHistoryReadHandlers(experimentHistoryStore);

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return handlers.detail(request, id);
}
