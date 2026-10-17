import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FakeModelProvider } from "../agent/providers/fake-model-provider";
import { SingleAgent } from "../agent/single-agent";
import { SingleAgentCriticRunner } from "../agent/single-agent-critic-runner";
import { TwoAgentHandoffRunner } from "../agent/two-agent-handoff-runner";
import { createTools } from "../tools/tool-registry";
import { SCENARIOS, type EvaluationContext, type Scenario } from "./scenarios";
import { runExperiment } from "./run-experiment";
import { createRunService, prepareRun } from "./run-service";
import { evaluateMultiDocumentChain, evaluateMultiDocumentConflict, evaluateMultiDocumentCalculation } from "./multi-document-scenario-evaluators";
import type { ExperimentEvent } from "./types";

beforeEach(() => vi.stubEnv("AGENTLAB_MODEL_PROVIDER", "fake"));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const configurations = ["baseline", "structured", "single-critic-audit-v1", "handoff-documents-v1"] as const;
const evaluators = [evaluateMultiDocumentChain, evaluateMultiDocumentConflict, evaluateMultiDocumentCalculation];

for (const [index, scenario] of (SCENARIOS.slice(5, 8) as readonly Scenario[]).entries()) for (const configurationId of configurations) {
  it(`${scenario.id}/${configurationId}: validates raw events before projection and rejects each corrupted event`, async () => {
    const responses = scenario.fakeByKind.single.primary;
    const final = responses.at(-1) as { type: "text"; text: string };
    const producer = () => new SingleAgent(new FakeModelProvider(responses), createTools(scenario.toolIds));
    const runner = configurationId === "handoff-documents-v1"
      ? new TwoAgentHandoffRunner(producer(), new SingleAgent(new FakeModelProvider([final])))
      : configurationId === "single-critic-audit-v1"
        ? new SingleAgentCriticRunner(new FakeModelProvider(responses), new FakeModelProvider(scenario.fakeByKind["single-critic"].critic), createTools(scenario.toolIds))
        : producer();
    const events: ExperimentEvent[] = [];
    const experiment = await runExperiment(scenario.task, runner, (event) => events.push(event));
    const evaluate = evaluators[index];
    const context: EvaluationContext = { configurationId };
    const original = structuredClone({ experiment, events });
    expect(evaluate(experiment, events, context).passed).toBe(true);
    expect({ experiment, events }).toEqual(original);
    expect(evaluate(experiment, events).passed).toBe(false);
    expect(evaluate(experiment, events, { configurationId: "handoff-default" }).passed).toBe(false);
    for (let position = 0; position < events.length; position += 1) {
      const deleted = events.filter((_, i) => i !== position);
      const duplicated = [...events.slice(0, position), events[position], ...events.slice(position)];
      const foreign = events.map((event, i) => i === position ? { ...event, experimentId: "foreign" } : event);
      expect(evaluate(experiment, deleted, context).passed, `deleted ${position}`).toBe(false);
      expect(evaluate(experiment, duplicated, context).passed, `duplicated ${position}`).toBe(false);
      expect(evaluate(experiment, foreign, context).passed, `foreign ${position}`).toBe(false);
      if (position + 1 < events.length) {
        const swapped = [...events];
        [swapped[position], swapped[position + 1]] = [swapped[position + 1], swapped[position]];
        expect(evaluate(experiment, swapped, context).passed, `swapped ${position}`).toBe(false);
      }
      if (/^(model|tool)\./.test(events[position].type)) {
        const scoped = structuredClone(events);
        const current = events[position];
        Object.assign(scoped[position], { agentId: configurationId === "handoff-documents-v1" && "agentId" in current && current.agentId === "finalizer" ? "analyst" : "finalizer" });
        expect(evaluate(experiment, scoped, context).passed, `scope ${position}`).toBe(false);
      }
    }
    const noTools = events.filter((event) => !event.type.startsWith("tool.") && !(event.type === "model.responded" && event.outcome === "tool_call"));
    expect(evaluate(experiment, noTools, context).passed).toBe(false);
    if (configurationId === "handoff-documents-v1") {
      const stripped = events.filter((event) => event.type !== "agent.lifecycle" && !event.type.startsWith("handoff."))
        .map((event) => { const copy = { ...event }; if ("agentId" in copy) delete copy.agentId; return copy; });
      expect(evaluate(experiment, stripped, context).passed).toBe(false);
      const last = events.findLastIndex((event) => event.type === "model.responded");
      const toolRequest = structuredClone(events);
      Object.assign(toolRequest[last], { outcome: "tool_call", finishReason: "tool_call" });
      expect(evaluate(experiment, toolRequest, context).passed).toBe(false);
      const withTool: ExperimentEvent[] = [...toolRequest.slice(0, last + 1),
        { experimentId: experiment.id, occurredAt: experiment.startedAt, type: "tool.started", toolName: "calculator", agentId: "finalizer" },
        { experimentId: experiment.id, occurredAt: experiment.startedAt, type: "tool.completed", toolName: "calculator", agentId: "finalizer" }, ...toolRequest.slice(last + 1)];
      expect(evaluate(experiment, withTool, context).passed).toBe(false);
    }
    // Keep all terminal copies consistent: failing here must be the unchanged RESULT evaluator.
    const wrong = final.text.replace(/=(dock-r2|14|161)/, "=999");
    const wrongEvents = events.map((event) => event.type === "agent.completed" ? { ...event, output: { type: "text" as const, text: wrong } }
      : event.type === "agent.lifecycle" && event.phase === "completed" && event.agentId === "finalizer" ? { ...event, output: wrong } : event);
    expect(evaluate({ ...experiment, output: { type: "text", text: wrong } }, wrongEvents, context).reason).toContain("result value");
  });
}

it("RunService passes authoritative plan configuration as evaluation context", async () => {
  const scenario = SCENARIOS[5];
  const evaluator = vi.spyOn(scenario, "evaluate");
  const plan = prepareRun({ task: scenario.task, scenarioId: scenario.id }, { configurationId: "structured" });
  await createRunService({ append: async () => {} }).executeRun(plan, { signal: new AbortController().signal });
  expect(evaluator).toHaveBeenCalledWith(expect.anything(), expect.anything(), { configurationId: "structured" });
});

it("a producer execution failure never starts the Critic", async () => {
  const critic = { complete: vi.fn() };
  const runner = new SingleAgentCriticRunner({ complete: async () => { throw new Error("offline"); } }, critic, []);
  const events: ExperimentEvent[] = [];
  const experiment = await runExperiment("document task", runner, (event) => events.push(event));
  expect(experiment.status).toBe("failed");
  expect(critic.complete).not.toHaveBeenCalled();
  expect(evaluateMultiDocumentChain(experiment, events, { configurationId: "single-critic-audit-v1" }).passed).toBe(false);
});
