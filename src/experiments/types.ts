import type { ModelResponse } from "../agent/model-provider";

export type ExperimentAgentId = "analyst" | "finalizer";

export type ExperimentStatus = "running" | "completed" | "failed";
export type ExperimentOutput = Extract<ModelResponse, { type: "text" }>;

export interface EvaluationResult {
  passed: boolean;
  reason: string;
}

export type ExperimentEventType =
  | "experiment.started"
  | "agent.started"
  | "agent.lifecycle"
  | "handoff.completed"
  | "handoff.failed"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "agent.completed"
  | "experiment.completed"
  | "experiment.failed"
  | "scenario.evaluated";

export interface Experiment {
  id: string;
  task: string;
  status: ExperimentStatus;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  output?: ExperimentOutput;
  errorMessage?: string;
}

interface ExperimentEventBase {
  experimentId: string;
  occurredAt: string;
}

export type ExperimentEvent =
  | (ExperimentEventBase & { type: "experiment.started" })
  | (ExperimentEventBase & { type: "agent.started" })
  | (ExperimentEventBase & { type: "tool.started"; toolName: string; agentId?: ExperimentAgentId })
  | (ExperimentEventBase & { type: "tool.completed"; toolName: string; agentId?: ExperimentAgentId })
  | (ExperimentEventBase & { type: "tool.failed"; toolName: string; agentId?: ExperimentAgentId })
  | (ExperimentEventBase & { type: "agent.lifecycle"; agentId: ExperimentAgentId; phase: "started" })
  | (ExperimentEventBase & { type: "agent.lifecycle"; agentId: ExperimentAgentId; phase: "completed"; output: string })
  | (ExperimentEventBase & {
      type: "agent.lifecycle";
      agentId: ExperimentAgentId;
      phase: "failed";
      failureCode: "agent_execution_failed";
    })
  | (ExperimentEventBase & { type: "handoff.completed"; fromAgentId: "analyst"; toAgentId: "finalizer" })
  | (ExperimentEventBase & {
      type: "handoff.failed";
      fromAgentId: "analyst";
      toAgentId: "finalizer";
      failureCode: "invalid_handoff";
    })
  | (ExperimentEventBase & { type: "agent.completed"; output: ExperimentOutput })
  | (ExperimentEventBase & {
      type: "experiment.completed";
      endedAt: string;
      durationMs: number;
    })
  | (ExperimentEventBase & {
      type: "experiment.failed";
      endedAt: string;
      durationMs: number;
      errorMessage: string;
    })
  | (ExperimentEventBase & {
      type: "scenario.evaluated";
      scenarioId: string;
      evaluation: EvaluationResult;
    });
