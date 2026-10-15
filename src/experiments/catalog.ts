import { ARCHITECTURE_DEFINITIONS } from "../agent/architecture-definitions";
import { SCENARIOS, comparisonConfigurations } from "./scenarios";

export function publicCatalog() {
  return { scenarios: SCENARIOS.map((scenario) => ({
    id: scenario.id, title: scenario.title, description: scenario.description, task: scenario.task,
    defaultConfiguration: { id: scenario.defaultConfigurationId, label: ARCHITECTURE_DEFINITIONS[scenario.defaultConfigurationId].label },
    comparisonConfigurations: comparisonConfigurations(scenario).map((id) => ({ id, label: ARCHITECTURE_DEFINITIONS[id].label })),
  })) };
}
export type PublicScenario = ReturnType<typeof publicCatalog>["scenarios"][number];
