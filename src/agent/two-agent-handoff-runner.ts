import { AgentFailure, failureCodeOf } from "./agent-failure";
import type { ModelResponse } from "./model-provider";
import type { ToolLifecycleSignal } from "./single-agent";
import { SingleAgent } from "./single-agent";

const HANDOFF_FAILURE_MESSAGE = "Agent handoff could not be completed.";

export interface HandoffPayload {
  task: string;
  context: string;
}

export type AgentId = "analyst" | "finalizer";

export type AgentLifecycleSignal =
  | { type: "agent.lifecycle"; agentId: AgentId; phase: "started" }
  | { type: "agent.lifecycle"; agentId: AgentId; phase: "completed"; output: string }
  | { type: "agent.lifecycle"; agentId: AgentId; phase: "failed"; failureCode: "agent_execution_failed" }
  | { type: "handoff.completed"; fromAgentId: "analyst"; toAgentId: "finalizer" }
  | {
      type: "handoff.failed";
      fromAgentId: "analyst";
      toAgentId: "finalizer";
      failureCode: "invalid_handoff";
    };

export class TwoAgentHandoffRunner {
  constructor(
    private readonly analyst: SingleAgent,
    private readonly finalizer: SingleAgent,
  ) {}

  async run(
    task: string,
    onToolLifecycle?: (signal: ToolLifecycleSignal & { agentId?: AgentId }) => void,
    onLifecycle?: (signal: AgentLifecycleSignal) => void,
  ): Promise<Extract<ModelResponse, { type: "text" }>> {
    if (task.trim().length === 0) {
      throw new AgentFailure("invalid_handoff", { message: HANDOFF_FAILURE_MESSAGE });
    }

    onLifecycle?.({ type: "agent.lifecycle", agentId: "analyst", phase: "started" });

    let analystResponse: Extract<ModelResponse, { type: "text" }>;
    try {
      analystResponse = await this.analyst.run(
        buildAnalystAssignment(task),
        (signal) => onToolLifecycle?.({ ...signal, agentId: "analyst" }),
      );
    } catch (error) {
      onLifecycle?.({
        type: "agent.lifecycle",
        agentId: "analyst",
        phase: "failed",
        failureCode: "agent_execution_failed",
      });
      // The inner agent's category (e.g. tool_unavailable) is kept so the experiment can report why it failed.
      throw new AgentFailure(failureCodeOf(error), { message: HANDOFF_FAILURE_MESSAGE, cause: error });
    }

    onLifecycle?.({
      type: "agent.lifecycle",
      agentId: "analyst",
      phase: "completed",
      output: analystResponse.text,
    });

    const handoff = createHandoffPayload(task, analystResponse.text);
    if (!handoff) {
      onLifecycle?.({
        type: "handoff.failed",
        fromAgentId: "analyst",
        toAgentId: "finalizer",
        failureCode: "invalid_handoff",
      });
      throw new AgentFailure("invalid_handoff", { message: HANDOFF_FAILURE_MESSAGE });
    }

    onLifecycle?.({
      type: "handoff.completed",
      fromAgentId: "analyst",
      toAgentId: "finalizer",
    });
    onLifecycle?.({ type: "agent.lifecycle", agentId: "finalizer", phase: "started" });

    try {
      const finalizerResponse = await this.finalizer.run(
        buildFinalizerAssignment(handoff),
        (signal) => onToolLifecycle?.({ ...signal, agentId: "finalizer" }),
      );
      onLifecycle?.({
        type: "agent.lifecycle",
        agentId: "finalizer",
        phase: "completed",
        output: finalizerResponse.text,
      });
      return finalizerResponse;
    } catch (error) {
      onLifecycle?.({
        type: "agent.lifecycle",
        agentId: "finalizer",
        phase: "failed",
        failureCode: "agent_execution_failed",
      });
      throw new AgentFailure(failureCodeOf(error), { message: HANDOFF_FAILURE_MESSAGE, cause: error });
    }
  }
}

function createHandoffPayload(task: string, context: string): HandoffPayload | undefined {
  if (task.trim().length === 0 || context.trim().length === 0) {
    return undefined;
  }

  return { task, context };
}

function buildAnalystAssignment(task: string): string {
  return [
    "Role: Analyst.",
    "Analyze the original task and return concise notes that help another agent complete it.",
    "Do not write the final response.",
    "",
    "Original task:",
    "---",
    task,
    "---",
  ].join("\n");
}

function buildFinalizerAssignment(handoff: HandoffPayload): string {
  return [
    "Role: Finalizer.",
    "Complete the original task. Use the Analyst context as supporting notes, and correct it if needed.",
    "",
    "Original task:",
    "---",
    handoff.task,
    "---",
    "Analyst context:",
    "---",
    handoff.context,
    "---",
  ].join("\n");
}
