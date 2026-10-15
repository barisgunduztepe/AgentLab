import type { FakeResponse } from "../agent/providers/fake-model-provider";
import { SCENARIOS } from "./scenarios";

type ScenarioId = Exclude<(typeof SCENARIOS)[number]["id"], "analyst-finalizer-handoff">;

const SCENARIO_FAKE_FIXTURES = {
  "direct-text": [
    { type: "text", text: "Istanbul connects historic trade routes, empires, and cultures. Its monuments reflect Roman, Byzantine, and Ottoman periods. Its location between Europe and Asia shaped its long-standing importance." },
  ],
  "calculator-once": [
    { type: "tool_call", call: { callId: "scenario-calculator-1", toolName: "calculator", arguments: { expression: "12 * 8" } } },
    { type: "text", text: "12 times 8 is 96." },
  ],
  "calculator-three-steps": [
    { type: "tool_call", call: { callId: "scenario-step-1", toolName: "calculator", arguments: { expression: "2 + 3" } } },
    { type: "tool_call", call: { callId: "scenario-step-2", toolName: "calculator", arguments: { expression: "7 + 8" } } },
    { type: "tool_call", call: { callId: "scenario-step-3", toolName: "calculator", arguments: { expression: "4 * 6" } } },
    { type: "text", text: "The three results are 5, 15, and 24." },
  ],
  "unknown-tool-failure": [
    { type: "tool_call", call: { callId: "scenario-unknown-tool", toolName: "weather_lookup", arguments: { expression: "Istanbul" } } },
  ],
} satisfies Record<ScenarioId, readonly FakeResponse[]>;

export function getScenarioFakeResponses(scenarioId: string): readonly FakeResponse[] | undefined {
  return SCENARIO_FAKE_FIXTURES[scenarioId as keyof typeof SCENARIO_FAKE_FIXTURES];
}

export function getComparisonFakeResponses(scenarioId: string): {
  baseline: readonly FakeResponse[];
  structured: readonly FakeResponse[];
} | undefined {
  const responses = getScenarioFakeResponses(scenarioId);
  if (!responses) return undefined;
  return { baseline: [...responses], structured: [...responses] };
}
