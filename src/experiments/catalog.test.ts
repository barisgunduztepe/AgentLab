import { expect, it, vi } from "vitest";
import { publicCatalog } from "./catalog";
import { SCENARIOS, comparisonConfigurations, type Scenario } from "./scenarios";
import { ARCHITECTURE_DEFINITIONS } from "../agent/architecture-definitions";

it("projects catalog without provider setup, fake responses or executable fields", () => {
  vi.stubEnv("AGENTLAB_MODEL_PROVIDER", "invalid");
  try {
    const catalog = publicCatalog();
    expect(catalog.scenarios).toHaveLength(8);
    expect(new Set(catalog.scenarios.map((scenario) => scenario.id)).size).toBe(8);
    expect(catalog.scenarios.filter((s) => s.comparisonConfigurations.length === 2).map((s) => s.id)).toEqual([...SCENARIOS.slice(0, 4), ...SCENARIOS.slice(5)].map((s) => s.id));
    expect(JSON.stringify(catalog)).not.toMatch(/fakeByKind|evaluate|providerSlots|callId|apiKey/);
    for (const scenario of SCENARIOS) {
      const definition = ARCHITECTURE_DEFINITIONS[scenario.defaultConfigurationId];
      expect(scenario.compatibleKinds).toContain(definition.scenarioKind);
      expect(definition.providerSlots.every((slot) => (scenario as Scenario).fakeByKind[definition.scenarioKind][slot]?.length)).toBe(true);
      expect(scenario.toolIds).toEqual(SCENARIOS.slice(0, 5).some((old) => old.id === scenario.id) ? ["calculator"] : ["document_search", "calculator"]);
      expect(comparisonConfigurations(scenario).length).toBe(scenario.comparison.enabled ? 2 : 0);
    }
    expect(SCENARIOS[4].evaluate).toBeNull();
  } finally { vi.unstubAllEnvs(); }
});
