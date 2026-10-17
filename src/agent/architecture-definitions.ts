/** Stable history identities. Retire entries with enabled:false; never remove old identities. */
export const ARCHITECTURE_DEFINITIONS = {
  baseline: { architecture: "single", version: 1, label: "baseline", description: "Original single-agent instructions.", enabled: true,
    scenarioKind: "single", providerSlots: ["primary"], toolPolicy: "scenario", audit: false, comparison: { role: "reference", order: 0, legacy: true } },
  structured: { architecture: "single", version: 1, label: "structured", description: "Single agent with labeled response sections.", enabled: true,
    scenarioKind: "single", providerSlots: ["primary"], toolPolicy: "scenario", audit: false, comparison: { role: "candidate", order: 1, legacy: true } },
  "handoff-default": { architecture: "handoff", version: 1, label: "Analyst / Finalizer", description: "One controlled handoff between two agents.", enabled: true,
    scenarioKind: "handoff", providerSlots: ["analyst", "finalizer"], toolPolicy: "scenario", audit: false, comparison: null },
  "single-critic-audit-v1": { architecture: "single-critic", version: 1, label: "baseline + Critic", description: "Baseline producer with one tool-free audit; no answer revision.", enabled: true,
    scenarioKind: "single-critic", providerSlots: ["producer", "critic"], toolPolicy: "scenario", audit: true, comparison: { role: "candidate", order: 2, legacy: false } },
  "handoff-documents-v1": { architecture: "handoff", version: 1, label: "Analyst / tool-free Finalizer", description: "Three shared tool executions by Analyst, then one tool-free Finalizer turn.", enabled: true,
    scenarioKind: "handoff-documents", providerSlots: ["analyst", "finalizer"], toolPolicy: "analyst-only", audit: false, comparison: { role: "candidate", order: 3, legacy: false } },
} as const;

export type RunConfigurationId = keyof typeof ARCHITECTURE_DEFINITIONS;
export type ArchitectureKind = (typeof ARCHITECTURE_DEFINITIONS)[RunConfigurationId]["architecture"];
export type ScenarioKind = (typeof ARCHITECTURE_DEFINITIONS)[RunConfigurationId]["scenarioKind"];
export function isRunConfigurationId(value: unknown): value is RunConfigurationId {
  return typeof value === "string" && Object.hasOwn(ARCHITECTURE_DEFINITIONS, value);
}
export const CONFIGURATION_IDS = Object.keys(ARCHITECTURE_DEFINITIONS) as RunConfigurationId[];
export const AVAILABLE_COMPARISON_CONFIGURATION_IDS = CONFIGURATION_IDS.filter((id) => ARCHITECTURE_DEFINITIONS[id].enabled && ARCHITECTURE_DEFINITIONS[id].comparison)
  .sort((a, b) => ARCHITECTURE_DEFINITIONS[a].comparison!.order - ARCHITECTURE_DEFINITIONS[b].comparison!.order);
export const COMPARISON_CONFIGURATION_IDS = AVAILABLE_COMPARISON_CONFIGURATION_IDS.filter((id) => ARCHITECTURE_DEFINITIONS[id].comparison?.legacy);
