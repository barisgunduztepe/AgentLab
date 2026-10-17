import { AgentFailure } from "./agent-failure";
import { throwIfCancelled } from "./cancellation";
import { copyModelUsage, validateRequest, validateResponse } from "./model-contract";
import type { ModelProvider, JsonObject } from "./model-provider";
import { SingleAgent, type ToolLifecycleSignal, type ModelCallSignal } from "./single-agent";
import { AUDIT_BUDGET, CRITIC_INSTRUCTION, MAX_EVIDENCE_BYTES, parseCriticReport, type AuditObserver, type AuditProgress } from "./critic-report";
import type { Tool } from "../tools/tool";
import type { ExperimentOutput } from "../experiments/types";

type Evidence = { id: number; toolName: string; input: JsonObject; output: string };

/** One baseline producer and one independent, tool-free audit. No answer revision. */
export class SingleAgentCriticRunner {
  constructor(
    private readonly producer: ModelProvider,
    private readonly critic: ModelProvider,
    private readonly tools: readonly Tool[],
    private readonly observe?: AuditObserver,
  ) {
    if (producer === critic) throw new Error("Producer and Critic require independent providers.");
  }

  async run(task: string, onTool?: (event: ToolLifecycleSignal) => void,
    onModel?: (event: ModelCallSignal) => void, options: { signal?: AbortSignal } = {}): Promise<ExperimentOutput> {
    const { signal } = options;
    throwIfCancelled(signal);
    const evidence: Evidence[] = [];
    let evidenceBytes = 0;
    let evidenceOverflow = false;
    let progress: AuditProgress = { phase: "producer", status: "not_started", producerModelCalls: 0, criticModelCalls: 0 };
    const publish = () => this.observe?.(structuredClone(progress));
    const tools = this.tools.map((tool): Tool => ({
      definition: structuredClone(tool.definition),
      validateInput: (input) => tool.validateInput(input),
      execute: async (input, toolOptions) => {
        // Capture input before a tool can mutate it; retain only successful results.
        const captured = structuredClone(input);
        const output = await tool.execute(input, toolOptions);
        throwIfCancelled(toolOptions.signal);
        if (typeof output === "string") {
          const entry = { id: evidence.length + 1, toolName: tool.definition.name, input: captured, output };
          evidenceBytes += new TextEncoder().encode(JSON.stringify(entry)).byteLength;
          if (evidenceBytes > MAX_EVIDENCE_BYTES || evidence.length >= AUDIT_BUDGET.toolExecutions) evidenceOverflow = true;
          else evidence.push(entry);
        }
        return output;
      },
    }));
    const producer: ModelProvider = { complete: async (request) => {
      if (progress.producerModelCalls >= AUDIT_BUDGET.producerModelCalls) throw new AgentFailure("unknown");
      progress.producerModelCalls += 1;
      return this.producer.complete(request);
    } };
    publish();
    try {
      const output = await new SingleAgent(producer, tools).run(task, onTool, onModel, options);
      throwIfCancelled(signal);
      if (evidenceOverflow) {
        progress = { ...progress, status: "evidence_limit" }; publish();
        throw new AgentFailure("unknown");
      }
      progress = { ...progress, phase: "critic", status: "running" };
      publish();
      throwIfCancelled(signal);
      const request = { messages: [
        { role: "system" as const, text: CRITIC_INSTRUCTION },
        { role: "user" as const, text: JSON.stringify({ task, producerAnswer: output.text, evidence }) },
      ], tools: [], ...(signal ? { signal } : {}) };
      validateRequest(request);
      onModel?.({ type: "model.requested", purpose: "initial" });
      progress.criticModelCalls += 1;
      const started = Date.now();
      let response;
      try {
        throwIfCancelled(signal);
        response = await this.critic.complete(request);
        throwIfCancelled(signal);
        validateResponse(response);
      } catch (cause) {
        onModel?.({ type: "model.responded", outcome: "error", durationMs: Date.now() - started, finishReason: "unknown", usage: null });
        throwIfCancelled(signal);
        const failure = cause instanceof AgentFailure && cause.failureCode === "invalid_tool_call" ? cause : new AgentFailure("provider_error");
        progress = { ...progress, status: failure.failureCode === "invalid_tool_call" ? "invalid_tool_call" : "provider_error" }; publish();
        throw failure;
      }
      onModel?.({ type: "model.responded", outcome: response.type, durationMs: Date.now() - started,
        finishReason: response.finishReason, usage: copyModelUsage(response.usage) });
      throwIfCancelled(signal);
      if (response.type === "tool_call") {
        progress = { ...progress, status: "tool_unavailable" }; publish();
        throw new AgentFailure("tool_unavailable");
      }
      if (!["stop", "unknown"].includes(response.finishReason)) {
        progress = { ...progress, status: "provider_error" }; publish();
        throw new AgentFailure("provider_error");
      }
      const report = parseCriticReport(response.text, evidence.length);
      if (!report) {
        progress = { ...progress, status: "invalid_report" }; publish();
        throw new AgentFailure("unknown");
      }
      progress = { ...progress, status: "completed", report }; publish();
      throwIfCancelled(signal);
      return output;
    } catch (cause) {
      if (signal?.aborted || (cause instanceof AgentFailure && cause.failureCode === "cancelled")) {
        progress = { ...progress, status: "cancelled", report: undefined }; publish();
        throw new AgentFailure("cancelled");
      }
      if (progress.phase === "producer") publish();
      throw cause;
    } finally {
      // Raw evidence/request data never lives on the reusable runner instance.
      evidence.length = 0;
    }
  }
}
