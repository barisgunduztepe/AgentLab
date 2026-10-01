export interface Scenario {
  id: string;
  title: string;
  description: string;
  task: string;
}

export const SCENARIOS = [
  {
    id: "direct-text",
    title: "Direct text response",
    description: "Run a task that needs no tool.",
    task: "Write three short sentences about why Istanbul is historically important.",
  },
  {
    id: "calculator-once",
    title: "Single calculator call",
    description: "Ask the agent to calculate a result and explain it.",
    task: "Use the calculator to calculate 12 * 8 and explain the result.",
  },
  {
    id: "calculator-three-steps",
    title: "Three calculator steps",
    description: "Run three calculator calls, then summarize their results.",
    task: "Use the calculator three times: calculate 2 + 3, 7 + 8, and 4 * 6, then summarize all three results.",
  },
  {
    id: "unknown-tool-failure",
    title: "Safe unknown-tool failure",
    description: "A scripted unavailable tool request should fail safely without running a tool.",
    task: "Look up the current weather in Istanbul using an appropriate tool.",
  },
  {
    id: "analyst-finalizer-handoff",
    title: "Analyst to Finalizer handoff",
    description: "Transfer concise Analyst notes once to a Finalizer for a clear answer.",
    task: "Explain how a household thermostat keeps a room near its target temperature.",
  },
] as const satisfies readonly Scenario[];

export function getScenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}
