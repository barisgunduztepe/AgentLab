import type { ModelResponse } from "./model-provider";
import type { ToolLifecycleSignal } from "./single-agent";
import { SingleAgent } from "./single-agent";

export interface HandoffPayload {
  task: string;
  context: string;
}

export class TwoAgentHandoffRunner {
  constructor(
    private readonly analyst: SingleAgent,
    private readonly finalizer: SingleAgent,
  ) {}

  async run(
    task: string,
    onToolLifecycle?: (signal: ToolLifecycleSignal) => void,
  ): Promise<Extract<ModelResponse, { type: "text" }>> {
    if (task.trim().length === 0) {
      throw new Error("Agent handoff could not be completed.");
    }

    let analystResponse: Extract<ModelResponse, { type: "text" }>;
    try {
      analystResponse = await this.analyst.run(buildAnalystAssignment(task), onToolLifecycle);
    } catch {
      throw new Error("Agent handoff could not be completed.");
    }

    const handoff = createHandoffPayload(task, analystResponse.text);
    if (!handoff) {
      throw new Error("Agent handoff could not be completed.");
    }

    try {
      return await this.finalizer.run(buildFinalizerAssignment(handoff), onToolLifecycle);
    } catch {
      throw new Error("Agent handoff could not be completed.");
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
