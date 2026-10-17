import { evaluateDocumentChain, evaluateDocumentConflict, evaluateDocumentCalculation } from "./document-scenario-evaluators";
import type { ScenarioEvaluator } from "./scenarios";
import type { ExperimentEvent } from "./types";

/** Validate the complete raw trace before making an evaluation-only projection. Never infer the configuration from events. */
function wrap(evaluate: ScenarioEvaluator): ScenarioEvaluator {
  return (experiment, events, context) => {
    const invalid = { passed: false, reason: "Multi-document scenario failed: observation contract." };
    const configuration = context?.configurationId;
    if (!["baseline", "structured", "single-critic-audit-v1", "handoff-documents-v1"].includes(configuration ?? "") ||
        experiment.status !== "completed" || experiment.output?.type !== "text" ||
        events.some((event) => event.experimentId !== experiment.id)) return invalid;
    let cursor = 0;
    const take = (type: ExperimentEvent["type"]) => {
      const event = events[cursor];
      if (event?.type !== type) throw new Error("Unexpected event.");
      cursor += 1;
      return event;
    };
    const unscoped = (event: ExperimentEvent) => {
      if ("agentId" in event && event.agentId !== undefined) throw new Error("Unexpected scope.");
    };
    let tools = 0;
    const turns = (role: "analyst" | "finalizer" | undefined, toolFree = false) => {
      let calls = 0;
      while (true) {
        const request = take("model.requested");
        const response = take("model.responded");
        for (const event of [request, response]) {
          if (("agentId" in event ? event.agentId : undefined) !== role) throw new Error("Wrong scope.");
        }
        if (request.type !== "model.requested" || request.purpose !== (calls === 0 ? "initial" : "after_tool") ||
            response.type !== "model.responded" || response.outcome === "error" ||
            ++calls > (toolFree ? 1 : 4)) throw new Error("Invalid model turn.");
        if (response.outcome === "text") {
          if (response.finishReason !== "stop" && response.finishReason !== "unknown") throw new Error("Incomplete text.");
          return;
        }
        if (toolFree || response.finishReason !== "tool_call") throw new Error("Unexpected tool request.");
        const start = take("tool.started");
        const end = take("tool.completed");
        if (start.type !== "tool.started" || end.type !== "tool.completed" || start.toolName !== end.toolName ||
            start.agentId !== role || end.agentId !== role || ++tools > 3) throw new Error("Invalid tool lifecycle.");
      }
    };
    const lifecycle = (role: "analyst" | "finalizer", phase: "started" | "completed") => {
      const event = take("agent.lifecycle");
      if (event.type !== "agent.lifecycle" || event.agentId !== role || event.phase !== phase) throw new Error("Invalid role lifecycle.");
      if (event.phase === "completed") {
        if (!event.output.trim() || (role === "analyst" && new TextEncoder().encode(event.output).byteLength > 8192) ||
            (role === "finalizer" && event.output !== experiment.output!.text)) throw new Error("Invalid role output.");
      }
    };
    try {
      unscoped(take("experiment.started"));
      unscoped(take("agent.started"));
      if (configuration === "handoff-documents-v1") {
        lifecycle("analyst", "started");
        turns("analyst");
        lifecycle("analyst", "completed");
        const handoff = take("handoff.completed");
        if (handoff.type !== "handoff.completed" || handoff.fromAgentId !== "analyst" || handoff.toAgentId !== "finalizer") throw new Error("Invalid handoff.");
        lifecycle("finalizer", "started");
        turns("finalizer", true);
        lifecycle("finalizer", "completed");
      } else {
        turns(undefined);
        if (configuration === "single-critic-audit-v1") turns(undefined, true);
      }
      const completed = take("agent.completed");
      if (completed.type !== "agent.completed" || completed.output.type !== "text" || completed.output.text !== experiment.output.text) return invalid;
      unscoped(completed);
      unscoped(take("experiment.completed"));
      if (cursor !== events.length) return invalid;
    } catch { return invalid; }
    const projected = events.filter((event) => event.type !== "agent.lifecycle" && event.type !== "handoff.completed")
      .map((event) => {
        const copy = { ...event };
        if ("agentId" in copy) delete copy.agentId;
        return copy;
      });
    return evaluate(experiment, projected);
  };
}

export const evaluateMultiDocumentChain = wrap(evaluateDocumentChain);
export const evaluateMultiDocumentConflict = wrap(evaluateDocumentConflict);
export const evaluateMultiDocumentCalculation = wrap(evaluateDocumentCalculation);
