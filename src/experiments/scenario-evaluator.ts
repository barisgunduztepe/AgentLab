import { getScenarioById } from "./scenarios";
import type { Experiment, ExperimentEvent } from "./types";
export function evaluateScenario(id: string, experiment: Experiment, events: readonly ExperimentEvent[]) {
  return getScenarioById(id)?.evaluate?.(experiment, events);
}
