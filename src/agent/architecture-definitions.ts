/** Stable history identities. Retire entries with enabled:false; never remove old identities. */
export const ARCHITECTURE_DEFINITIONS = {
  baseline: { architecture: "single", version: 1, label: "baseline", description: "Original single-agent instructions.", enabled: true,
    scenarioKind: "single", providerSlots: ["primary"], toolPolicy: "scenario", comparison: { role: "reference", order: 0 } },
  structured: { architecture: "single", version: 1, label: "structured", description: "Single agent with labeled response sections.", enabled: true,
    scenarioKind: "single", providerSlots: ["primary"], toolPolicy: "scenario", comparison: { role: "candidate", order: 1 } },
  "handoff-default": { architecture: "handoff", version: 1, label: "Analyst / Finalizer", description: "One controlled handoff between two agents.", enabled: true,
    scenarioKind: "handoff", providerSlots: ["analyst", "finalizer"], toolPolicy: "scenario", comparison: null },
} as const;

export type RunConfigurationId = keyof typeof ARCHITECTURE_DEFINITIONS;
export type ArchitectureKind = (typeof ARCHITECTURE_DEFINITIONS)[RunConfigurationId]["architecture"];
export function isRunConfigurationId(value: unknown): value is RunConfigurationId {
  return typeof value === "string" && Object.hasOwn(ARCHITECTURE_DEFINITIONS, value);
}
export const CONFIGURATION_IDS = Object.keys(ARCHITECTURE_DEFINITIONS) as RunConfigurationId[];
export const COMPARISON_CONFIGURATION_IDS = CONFIGURATION_IDS.filter((id) => ARCHITECTURE_DEFINITIONS[id].enabled && ARCHITECTURE_DEFINITIONS[id].comparison)
  .sort((a, b) => ARCHITECTURE_DEFINITIONS[a].comparison!.order - ARCHITECTURE_DEFINITIONS[b].comparison!.order);
