import { expect, it, vi } from "vitest";
import { publicCatalog } from "./catalog";
import { SCENARIOS, comparisonConfigurations, type Scenario } from "./scenarios";
import { ARCHITECTURE_DEFINITIONS } from "../agent/architecture-definitions";
import { TOOL_FACTORIES } from "../tools/tool-registry";
import { readFileSync } from "node:fs";

it("projects catalog without provider setup, fake responses or executable fields", () => {
  vi.stubEnv("AGENTLAB_MODEL_PROVIDER", "invalid");
  const calculator = vi.spyOn(TOOL_FACTORIES, "calculator");
  const search = vi.spyOn(TOOL_FACTORIES, "document_search");
  try {
    const catalog = publicCatalog();
    expect(catalog.scenarios).toHaveLength(8);
    expect(new Set(catalog.scenarios.map((scenario) => scenario.id)).size).toBe(8);
    expect(catalog.scenarios.filter((s) => s.comparisonConfigurations.length === 2).map((s) => s.id)).toEqual([...SCENARIOS.slice(0, 4), ...SCENARIOS.slice(5)].map((s) => s.id));
    expect(JSON.stringify(catalog)).not.toMatch(/fakeByKind|evaluate|providerSlots|callId|apiKey/);
    expect(JSON.stringify(catalog)).not.toMatch(/parameters|agentlab-docs-v1|dock-r2|credits=161|text":/);
    expect(calculator).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
    for (const [index, scenario] of catalog.scenarios.entries()) {
      expect(scenario.tools).toEqual(SCENARIOS[index].toolIds.map((id) => ({ id, label: id })));
      expect(Object.keys(scenario).sort()).toEqual(["id", "title", "description", "task", "tools", "defaultConfiguration", "comparisonConfigurations"].sort());
    }
    for (const scenario of SCENARIOS) {
      const definition = ARCHITECTURE_DEFINITIONS[scenario.defaultConfigurationId];
      expect(scenario.compatibleKinds).toContain(definition.scenarioKind);
      expect(definition.providerSlots.every((slot) => (scenario as Scenario).fakeByKind[definition.scenarioKind][slot]?.length)).toBe(true);
      expect(scenario.toolIds).toEqual(SCENARIOS.slice(0, 5).some((old) => old.id === scenario.id) ? ["calculator"] : ["document_search", "calculator"]);
      expect(comparisonConfigurations(scenario).length).toBe(scenario.comparison.enabled ? 2 : 0);
    }
    expect(SCENARIOS[4].evaluate).toBeNull();
  } finally { vi.unstubAllEnvs(); vi.restoreAllMocks(); }
});

it("keeps the UI catalog import type-only and renders only tool labels", () => {
  const source = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  expect(source).toMatch(/import type \{ PublicScenario \} from/);
  expect(source).not.toMatch(/from ["'][^"']*(?:scenarios|tool-registry|document-search|document-scenario-evaluators)["']/);
  expect(source).toContain("Tools: {selectedScenario.tools.map((tool) => tool.label).join(\", \")}");
});
