import { experimentHistoryStore } from "../../../../experiments/experiment-history";
import { createHistoryReadHandlers } from "./history-read-handlers";

export const GET = createHistoryReadHandlers(experimentHistoryStore).list;
