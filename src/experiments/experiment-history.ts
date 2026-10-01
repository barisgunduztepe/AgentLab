import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { EvaluationResult, ExperimentEvent } from "./types";

export interface ExperimentHistoryRecord {
  schemaVersion: 1 | 2;
  id: string;
  task: string;
  status: "completed" | "failed";
  startedAt: string;
  endedAt: string;
  durationMs: number;
  scenarioId?: string;
  output?: { type: "text"; text: string };
  errorMessage?: string;
  evaluation?: EvaluationResult;
  events: ExperimentEvent[];
  comparisonId?: string;
  configurationId?: "baseline" | "structured";
}

export type ExperimentHistorySummary = Pick<
  ExperimentHistoryRecord,
  | "id" | "task" | "status" | "startedAt" | "endedAt" | "durationMs" | "scenarioId" | "evaluation"
  | "comparisonId" | "configurationId"
>;

interface ExperimentHistorySnapshot {
  schemaVersion: 1 | 2;
  records: ExperimentHistoryRecord[];
}

export class ExperimentHistoryError extends Error {
  constructor(readonly code: "storage_unavailable" | "invalid_snapshot" | "unsupported_schema" | "duplicate_record") {
    super("Experiment history is unavailable.");
    this.name = "ExperimentHistoryError";
  }
}

export function getDefaultExperimentHistoryPath(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = homedir(),
): string {
  const configuredDirectory = platform === "win32"
    ? environment.LOCALAPPDATA?.trim()
    : environment.XDG_DATA_HOME?.trim();
  const localDataDirectory = configuredDirectory && isAbsolute(configuredDirectory)
    ? configuredDirectory
    : platform === "win32"
      ? join(homeDirectory, "AppData", "Local")
      : join(homeDirectory, ".local", "share");

  return join(localDataDirectory, "AgentLab", "experiments.json");
}

export class ExperimentHistoryStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(readonly filePath: string = getDefaultExperimentHistoryPath()) {}

  append(record: ExperimentHistoryRecord): Promise<void> {
    const safeRecord = sanitizeRecord(record);
    const operation = this.writeQueue.then(() => this.appendSerialized(safeRecord));
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  async readAll(): Promise<ExperimentHistoryRecord[]> {
    await this.writeQueue;
    return (await this.readSnapshot()).records;
  }

  async listSummaries(): Promise<ExperimentHistorySummary[]> {
    await this.writeQueue;
    const records = (await this.readSnapshot()).records;
    return records
      .slice()
      .sort((left, right) =>
        Date.parse(right.endedAt) - Date.parse(left.endedAt) || compareIds(left.id, right.id),
      )
      .map(({ id, task, status, startedAt, endedAt, durationMs, scenarioId, evaluation, comparisonId, configurationId }) => ({
        id,
        task,
        status,
        startedAt,
        endedAt,
        durationMs,
        ...(scenarioId === undefined ? {} : { scenarioId }),
        ...(evaluation === undefined ? {} : { evaluation }),
        ...(comparisonId === undefined ? {} : { comparisonId }),
        ...(configurationId === undefined ? {} : { configurationId }),
      }));
  }

  async getById(id: string): Promise<ExperimentHistoryRecord | undefined> {
    await this.writeQueue;
    const records = (await this.readSnapshot()).records;
    return records.find((record) => record.id === id);
  }

  private async appendSerialized(record: ExperimentHistoryRecord): Promise<void> {
    const snapshot = await this.readSnapshot();
    if (snapshot.records.some((existing) => existing.id === record.id)) {
      throw new ExperimentHistoryError("duplicate_record");
    }

    snapshot.records.push(record);
    if (record.schemaVersion === 2) snapshot.schemaVersion = 2;
    snapshot.records.sort((left, right) =>
      left.endedAt.localeCompare(right.endedAt) || left.id.localeCompare(right.id),
    );
    await this.replaceSnapshot(snapshot);
  }

  private async readSnapshot(): Promise<ExperimentHistorySnapshot> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { schemaVersion: 1, records: [] };
      }
      throw new ExperimentHistoryError("storage_unavailable");
    }

    let value: unknown;
    try {
      value = JSON.parse(contents);
    } catch {
      throw new ExperimentHistoryError("invalid_snapshot");
    }

    if (!isPlainRecord(value)) {
      throw new ExperimentHistoryError("invalid_snapshot");
    }
    if (value.schemaVersion !== 1 && value.schemaVersion !== 2) {
      throw new ExperimentHistoryError("unsupported_schema");
    }
    if (!hasExactKeys(value, ["schemaVersion", "records"]) || !Array.isArray(value.records)) {
      throw new ExperimentHistoryError("invalid_snapshot");
    }

    const records = value.records.map(parseRecord);
    if (new Set(records.map((record) => record.id)).size !== records.length) {
      throw new ExperimentHistoryError("invalid_snapshot");
    }

    if (value.schemaVersion === 1 && records.some((record) => record.schemaVersion !== 1)) {
      throw new ExperimentHistoryError("invalid_snapshot");
    }
    return { schemaVersion: value.schemaVersion, records };
  }

  private async replaceSnapshot(snapshot: ExperimentHistorySnapshot): Promise<void> {
    const directory = dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(temporaryPath, JSON.stringify(snapshot, null, 2), { encoding: "utf8", flag: "wx" });
      await rename(temporaryPath, this.filePath);
    } catch {
      try {
        await unlink(temporaryPath);
      } catch {
        // Keep the original storage error private; a temporary file is harmless and uniquely named.
      }
      throw new ExperimentHistoryError("storage_unavailable");
    }
  }
}

export const experimentHistoryStore = new ExperimentHistoryStore();

function sanitizeRecord(record: ExperimentHistoryRecord): ExperimentHistoryRecord {
  if (!isValidRecord(record, false)) {
    throw new ExperimentHistoryError("invalid_snapshot");
  }

  return {
    schemaVersion: record.schemaVersion,
    id: record.id,
    task: record.task,
    status: record.status,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    durationMs: record.durationMs,
    ...(record.scenarioId === undefined ? {} : { scenarioId: record.scenarioId }),
    ...(record.output === undefined ? {} : { output: { type: "text", text: record.output.text } }),
    ...(record.errorMessage === undefined ? {} : { errorMessage: record.errorMessage }),
    ...(record.evaluation === undefined ? {} : {
      evaluation: { passed: record.evaluation.passed, reason: record.evaluation.reason },
    }),
    ...(record.schemaVersion === 2 ? {
      comparisonId: record.comparisonId,
      configurationId: record.configurationId,
    } : {}),
    events: record.events.map((event) => sanitizeEvent(event, false)),
  };
}

function parseRecord(value: unknown): ExperimentHistoryRecord {
  if (!isValidRecord(value, true)) {
    throw new ExperimentHistoryError("invalid_snapshot");
  }

  const record = value as ExperimentHistoryRecord;
  return {
    schemaVersion: record.schemaVersion,
    id: record.id,
    task: record.task,
    status: record.status,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    durationMs: record.durationMs,
    ...(record.scenarioId === undefined ? {} : { scenarioId: record.scenarioId }),
    ...(record.output === undefined ? {} : { output: { type: "text", text: record.output.text } }),
    ...(record.errorMessage === undefined ? {} : { errorMessage: record.errorMessage }),
    ...(record.evaluation === undefined ? {} : {
      evaluation: { passed: record.evaluation.passed, reason: record.evaluation.reason },
    }),
    ...(record.schemaVersion === 2 ? {
      comparisonId: record.comparisonId,
      configurationId: record.configurationId,
    } : {}),
    events: record.events.map((event) => sanitizeEvent(event, true)),
  };
}

function isValidRecord(value: unknown, strictKeys: boolean): value is ExperimentHistoryRecord {
  if (!isPlainRecord(value)) return false;

  const allowedKeys = [
    "schemaVersion", "id", "task", "status", "startedAt", "endedAt", "durationMs",
    "scenarioId", "output", "errorMessage", "evaluation", "events", "comparisonId", "configurationId",
  ];
  if (strictKeys && !hasOnlyKeys(value, allowedKeys)) return false;
  if (
    (value.schemaVersion !== 1 && value.schemaVersion !== 2) ||
    typeof value.id !== "string" || value.id.length === 0 ||
    typeof value.task !== "string" ||
    (value.status !== "completed" && value.status !== "failed") ||
    typeof value.startedAt !== "string" || Number.isNaN(Date.parse(value.startedAt)) ||
    typeof value.endedAt !== "string" || Number.isNaN(Date.parse(value.endedAt)) ||
    typeof value.durationMs !== "number" || !Number.isFinite(value.durationMs) || value.durationMs < 0 ||
    !Array.isArray(value.events)
  ) return false;

  if (value.scenarioId !== undefined && (typeof value.scenarioId !== "string" || value.scenarioId.length === 0)) return false;
  if (value.output !== undefined && (!isPlainRecord(value.output) ||
    !hasExactKeys(value.output, ["type", "text"]) || value.output.type !== "text" || typeof value.output.text !== "string")) return false;
  if (value.errorMessage !== undefined && typeof value.errorMessage !== "string") return false;
  if (value.evaluation !== undefined && (!isPlainRecord(value.evaluation) ||
    !hasExactKeys(value.evaluation, ["passed", "reason"]) || typeof value.evaluation.passed !== "boolean" ||
    typeof value.evaluation.reason !== "string")) return false;

  if (value.status === "completed" && (value.output === undefined || value.errorMessage !== undefined)) return false;
  if (value.status === "failed" && (value.output !== undefined || value.errorMessage === undefined)) return false;

  if (value.evaluation !== undefined && value.scenarioId === undefined) return false;
  if (value.schemaVersion === 1 && (value.comparisonId !== undefined || value.configurationId !== undefined)) return false;
  if (value.schemaVersion === 2 && (
    typeof value.comparisonId !== "string" || value.comparisonId.length === 0 ||
    (value.configurationId !== "baseline" && value.configurationId !== "structured")
  )) return false;

  return value.events.every((event) =>
    isValidEvent(event, strictKeys) && event.experimentId === value.id,
  );
}

function isValidEvent(value: unknown, strictKeys: boolean): value is ExperimentEvent {
  if (!isPlainRecord(value) || typeof value.experimentId !== "string" || value.experimentId.length === 0 ||
    typeof value.occurredAt !== "string" || Number.isNaN(Date.parse(value.occurredAt))) return false;

  const hasKeys = (keys: string[]) => !strictKeys || hasExactKeys(value, ["experimentId", "occurredAt", "type", ...keys]);
  switch (value.type) {
    case "experiment.started":
    case "agent.started":
      return hasKeys([]);
    case "tool.started":
    case "tool.completed":
    case "tool.failed":
      return hasKeys(value.agentId === undefined ? ["toolName"] : ["toolName", "agentId"]) &&
        typeof value.toolName === "string" &&
        (value.agentId === undefined || value.agentId === "analyst" || value.agentId === "finalizer");
    case "agent.lifecycle":
      if (value.agentId !== "analyst" && value.agentId !== "finalizer") return false;
      if (value.phase === "started") return hasKeys(["agentId", "phase"]);
      if (value.phase === "completed") return hasKeys(["agentId", "phase", "output"]) && typeof value.output === "string";
      if (value.phase === "failed") return hasKeys(["agentId", "phase", "failureCode"]) && value.failureCode === "agent_execution_failed";
      return false;
    case "handoff.completed":
      return hasKeys(["fromAgentId", "toAgentId"]) && value.fromAgentId === "analyst" && value.toAgentId === "finalizer";
    case "handoff.failed":
      return hasKeys(["fromAgentId", "toAgentId", "failureCode"]) && value.fromAgentId === "analyst" &&
        value.toAgentId === "finalizer" && value.failureCode === "invalid_handoff";
    case "agent.completed":
      return hasKeys(["output"]) && isPlainRecord(value.output) && hasExactKeys(value.output, ["type", "text"]) &&
        value.output.type === "text" && typeof value.output.text === "string";
    case "experiment.completed":
      return hasKeys(["endedAt", "durationMs"]) && typeof value.endedAt === "string" &&
        !Number.isNaN(Date.parse(value.endedAt)) && typeof value.durationMs === "number" && Number.isFinite(value.durationMs);
    case "experiment.failed":
      return hasKeys(["endedAt", "durationMs", "errorMessage"]) && typeof value.endedAt === "string" &&
        !Number.isNaN(Date.parse(value.endedAt)) && typeof value.durationMs === "number" && Number.isFinite(value.durationMs) &&
        typeof value.errorMessage === "string";
    case "scenario.evaluated":
      return hasKeys(["scenarioId", "evaluation"]) && typeof value.scenarioId === "string" &&
        isPlainRecord(value.evaluation) && hasExactKeys(value.evaluation, ["passed", "reason"]) &&
        typeof value.evaluation.passed === "boolean" && typeof value.evaluation.reason === "string";
    default:
      return false;
  }
}

function sanitizeEvent(event: ExperimentEvent, strictKeys: boolean): ExperimentEvent {
  if (!isValidEvent(event, strictKeys)) {
    throw new ExperimentHistoryError("invalid_snapshot");
  }

  const base = { experimentId: event.experimentId, occurredAt: event.occurredAt };
  switch (event.type) {
    case "experiment.started":
    case "agent.started":
      return { ...base, type: event.type };
    case "tool.started":
    case "tool.completed":
    case "tool.failed":
      return { ...base, type: event.type, toolName: event.toolName, ...(event.agentId ? { agentId: event.agentId } : {}) };
    case "agent.lifecycle":
      if (event.phase === "started") return { ...base, type: event.type, agentId: event.agentId, phase: event.phase };
      if (event.phase === "completed") return { ...base, type: event.type, agentId: event.agentId, phase: event.phase, output: event.output };
      return { ...base, type: event.type, agentId: event.agentId, phase: event.phase, failureCode: event.failureCode };
    case "handoff.completed":
      return { ...base, type: event.type, fromAgentId: event.fromAgentId, toAgentId: event.toAgentId };
    case "handoff.failed":
      return { ...base, type: event.type, fromAgentId: event.fromAgentId, toAgentId: event.toAgentId, failureCode: event.failureCode };
    case "agent.completed":
      return { ...base, type: event.type, output: { type: "text", text: event.output.text } };
    case "experiment.completed":
      return { ...base, type: event.type, endedAt: event.endedAt, durationMs: event.durationMs };
    case "experiment.failed":
      return { ...base, type: event.type, endedAt: event.endedAt, durationMs: event.durationMs, errorMessage: event.errorMessage };
    case "scenario.evaluated":
      return { ...base, type: event.type, scenarioId: event.scenarioId, evaluation: { passed: event.evaluation.passed, reason: event.evaluation.reason } };
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
