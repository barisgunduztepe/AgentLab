import type {
  ExperimentHistoryRecord,
  ExperimentHistoryStore,
  ExperimentHistorySummary,
} from "../../../../experiments/experiment-history";

type HistoryReadStore = Pick<ExperimentHistoryStore, "listSummaries" | "getById">;

export function createHistoryReadHandlers(store: HistoryReadStore) {
  return {
    async list(request: Request): Promise<Response> {
      if (!hasLoopbackHost(request)) return localOnlyResponse();

      try {
        const experiments: ExperimentHistorySummary[] = await store.listSummaries();
        return Response.json({ experiments }, { headers: { "Cache-Control": "no-store" } });
      } catch {
        return historyUnavailableResponse();
      }
    },

    async detail(request: Request, id: string): Promise<Response> {
      if (!hasLoopbackHost(request)) return localOnlyResponse();

      try {
        const experiment: ExperimentHistoryRecord | undefined = await store.getById(id);
        return experiment
          ? Response.json(experiment, { headers: { "Cache-Control": "no-store" } })
          : Response.json({ error: "Experiment not found." }, {
              status: 404,
              headers: { "Cache-Control": "no-store" },
            });
      } catch {
        return historyUnavailableResponse();
      }
    },
  };
}

function hasLoopbackHost(request: Request): boolean {
  const host = request.headers.get("host");
  if (!host) return false;

  try {
    const parsed = new URL(`http://${host}`);
    const hostname = parsed.hostname.toLowerCase();
    return !parsed.username && !parsed.password && parsed.pathname === "/" &&
      parsed.search === "" && parsed.hash === "" &&
      (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]");
  } catch {
    return false;
  }
}

function localOnlyResponse(): Response {
  return Response.json({ error: "History is available only from this device." }, {
    status: 403,
    headers: { "Cache-Control": "no-store" },
  });
}

function historyUnavailableResponse(): Response {
  return Response.json({ error: "Experiment history is unavailable." }, {
    status: 500,
    headers: { "Cache-Control": "no-store" },
  });
}
