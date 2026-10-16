import type { FakeResponse } from "../agent/providers/fake-model-provider";
import type { ToolId } from "../tools/tool-registry";
import type { RunConfigurationId, ArchitectureKind } from "../agent/architecture-definitions";
import { ARCHITECTURE_DEFINITIONS, COMPARISON_CONFIGURATION_IDS } from "../agent/architecture-definitions";
import { evaluateDirectText, evaluateCalculatorOnce, evaluateCalculatorThreeSteps, evaluateUnknownTool } from "./scenario-evaluators";
import type { Experiment, ExperimentEvent, EvaluationResult } from "./types";
export type ScenarioEvaluator = (experiment: Experiment, events: readonly ExperimentEvent[]) => EvaluationResult;
export interface Scenario {
  id: string;
  title: string;
  description: string;
  task: string;
  defaultConfigurationId: RunConfigurationId;
  compatibleKinds: readonly ArchitectureKind[];
  toolIds: readonly ToolId[];
  evaluate: ScenarioEvaluator | null;
  comparison: { enabled: boolean };
  fakeByKind: Readonly<Record<string, Readonly<Record<string, readonly FakeResponse[]>>>>;
}

export const SCENARIOS = [
  {
    id: "direct-text",
    title: "Direct text response",
    description: "Run a task that needs no tool.",
    task: "Write three short sentences about why Istanbul is historically important.",
    defaultConfigurationId: "baseline", compatibleKinds: ["single"],
    toolIds: ["calculator"], evaluate: evaluateDirectText, comparison: { enabled: true },
    fakeByKind: { single: { primary: [
    { type: "text", text: "Istanbul connects historic trade routes, empires, and cultures. Its monuments reflect Roman, Byzantine, and Ottoman periods. Its location between Europe and Asia shaped its long-standing importance." },
  ] } },
  },
  {
    id: "calculator-once",
    title: "Single calculator call",
    description: "Ask the agent to calculate a result and explain it.",
    task: "Use the calculator to calculate 12 * 8 and explain the result.",
    defaultConfigurationId: "baseline", compatibleKinds: ["single"],
    toolIds: ["calculator"], evaluate: evaluateCalculatorOnce, comparison: { enabled: true },
    fakeByKind: { single: { primary: [
    { type: "tool_call", call: { callId: "scenario-calculator-1", toolName: "calculator", arguments: { expression: "12 * 8" } } },
    { type: "text", text: "12 times 8 is 96." },
  ] } },
  },
  {
    id: "calculator-three-steps",
    title: "Three calculator steps",
    description: "Run three calculator calls, then summarize their results.",
    task: "Use the calculator three times: calculate 2 + 3, 7 + 8, and 4 * 6, then summarize all three results.",
    defaultConfigurationId: "baseline", compatibleKinds: ["single"],
    toolIds: ["calculator"], evaluate: evaluateCalculatorThreeSteps, comparison: { enabled: true },
    fakeByKind: { single: { primary: [
    { type: "tool_call", call: { callId: "scenario-step-1", toolName: "calculator", arguments: { expression: "2 + 3" } } },
    { type: "tool_call", call: { callId: "scenario-step-2", toolName: "calculator", arguments: { expression: "7 + 8" } } },
    { type: "tool_call", call: { callId: "scenario-step-3", toolName: "calculator", arguments: { expression: "4 * 6" } } },
    { type: "text", text: "The three results are 5, 15, and 24." },
  ] } },
  },
  {
    id: "unknown-tool-failure",
    title: "Safe unknown-tool failure",
    description: "A scripted unavailable tool request should fail safely without running a tool.",
    task: "Look up the current weather in Istanbul using an appropriate tool.",
    defaultConfigurationId: "baseline", compatibleKinds: ["single"],
    toolIds: ["calculator"], evaluate: evaluateUnknownTool, comparison: { enabled: true },
    fakeByKind: { single: { primary: [
    { type: "tool_call", call: { callId: "scenario-unknown-tool", toolName: "weather_lookup", arguments: { expression: "Istanbul" } } },
  ] } },
  },
  {
    id: "analyst-finalizer-handoff",
    title: "Analyst to Finalizer handoff",
    description: "Transfer concise Analyst notes once to a Finalizer for a clear answer.",
    task: "Explain how a household thermostat keeps a room near its target temperature.",
    defaultConfigurationId: "handoff-default", compatibleKinds: ["handoff"],
    toolIds: ["calculator"], evaluate: null, comparison: { enabled: false },
    fakeByKind: { handoff: {
  analyst: [
    {
      type: "text",
      text: "A thermostat measures room temperature, compares it with the set point, and activates heating or cooling to reduce the difference.",
    },
  ],
  finalizer: [
    {
      type: "text",
      text: "A thermostat keeps a room near its target by measuring the air temperature and comparing it with the set point. When the room is too cold or hot, it turns heating or cooling on, then switches it off as the target is reached.",
    },
  ],
} },
  },
] as const satisfies readonly Scenario[];

export function getScenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}

export function comparisonConfigurations(scenario: Scenario): RunConfigurationId[] {
  return scenario.comparison.enabled ? COMPARISON_CONFIGURATION_IDS.filter((id) => scenario.compatibleKinds.includes(ARCHITECTURE_DEFINITIONS[id].scenarioKind)) : [];
}
