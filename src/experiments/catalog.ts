import { ARCHITECTURE_DEFINITIONS } from "../agent/architecture-definitions";
import { SCENARIOS, comparisonConfigurations, type Scenario } from "./scenarios";
import { publicTools } from "../tools/tool-registry";

export function publicCatalog(version: 1 | 2 = 1) {
  return { ...(version === 2 ? { comparisonVersion: 2 as const } : {}), scenarios: SCENARIOS.filter((scenario) => ((scenario as Scenario).minimumTransportVersion ?? 1) <= version).map((scenario) => ({
    id: scenario.id, title: scenario.title, description: scenario.description, task: scenario.task,
    tools: publicTools(scenario.toolIds),
    defaultConfiguration: { id: scenario.defaultConfigurationId, label: ARCHITECTURE_DEFINITIONS[scenario.defaultConfigurationId].label },
    comparisonConfigurations: comparisonConfigurations(scenario, version).map((id) => ({ id, label: ARCHITECTURE_DEFINITIONS[id].label })),
  })) };
}
export type PublicScenario = ReturnType<typeof publicCatalog>["scenarios"][number];
