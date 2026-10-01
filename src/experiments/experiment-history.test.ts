import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ExperimentHistoryError,
  ExperimentHistoryStore,
  getDefaultExperimentHistoryPath,
  type ExperimentHistoryRecord,
} from "./experiment-history";

let temporaryDirectory: string;
let store: ExperimentHistoryStore;

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "agentlab-history-"));
  store = new ExperimentHistoryStore(join(temporaryDirectory, "experiments.json"));
});

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

describe("ExperimentHistoryStore", () => {
  it("treats a missing history file as empty", async () => {
    await expect(store.readAll()).resolves.toEqual([]);
  });

  it("saves and reads a completed record", async () => {
    const record = historyRecord("completed-1", "completed", "2026-10-01T00:00:01.000Z");

    await store.append(record);

    await expect(store.readAll()).resolves.toEqual([record]);
  });

  it("saves a failed record without fabricating output", async () => {
    const record = historyRecord("failed-1", "failed", "2026-10-01T00:00:01.000Z");

    await store.append(record);

    const [saved] = await store.readAll();
    expect(saved.status).toBe("failed");
    expect(saved.errorMessage).toBe("Agent görevi tamamlayamadı.");
    expect(saved).not.toHaveProperty("output");
  });

  it("preserves existing records and sorts them deterministically by terminal time", async () => {
    const later = historyRecord("later", "completed", "2026-10-01T00:00:02.000Z");
    const earlier = historyRecord("earlier", "completed", "2026-10-01T00:00:01.000Z");

    await store.append(later);
    await store.append(earlier);

    await expect(store.readAll()).resolves.toEqual([earlier, later]);
  });

  it("lists only summary fields newest-first without changing canonical storage order", async () => {
    const older = historyRecord("older", "completed", "2026-10-01T00:00:01.000Z");
    const newer = historyRecord("newer", "completed", "2026-10-01T00:00:02.000Z");
    await store.append(older);
    await store.append(newer);

    const summaries = await store.listSummaries();

    expect(summaries.map(({ id }) => id)).toEqual(["newer", "older"]);
    expect(summaries[0]).toEqual({
      id: "newer",
      task: newer.task,
      status: "completed",
      startedAt: newer.startedAt,
      endedAt: newer.endedAt,
      durationMs: newer.durationMs,
    });
    expect(summaries[0]).not.toHaveProperty("events");
    await expect(store.readAll()).resolves.toEqual([older, newer]);
  });

  it("includes optional scenario and evaluation fields in summaries", async () => {
    const evaluated = {
      ...historyRecord("evaluated", "completed", "2026-10-01T00:00:01.000Z"),
      scenarioId: "direct-text",
      evaluation: { passed: true, reason: "Completed with text." },
    } satisfies ExperimentHistoryRecord;
    await store.append(evaluated);

    await expect(store.listSummaries()).resolves.toMatchObject([{
      id: "evaluated",
      scenarioId: "direct-text",
      evaluation: { passed: true, reason: "Completed with text." },
    }]);
  });

  it("uses the ID as a deterministic tie-breaker for equal end times", async () => {
    await store.append(historyRecord("z-run", "completed", "2026-10-01T00:00:01.000Z"));
    await store.append(historyRecord("a-run", "completed", "2026-10-01T00:00:01.000Z"));

    await expect(store.listSummaries()).resolves.toMatchObject([{ id: "a-run" }, { id: "z-run" }]);
  });

  it("returns a validated record by ID and undefined for an unknown ID", async () => {
    const record = historyRecord("selected-run", "completed", "2026-10-01T00:00:01.000Z");
    await store.append(record);

    await expect(store.getById("selected-run")).resolves.toEqual(record);
    await expect(store.getById("missing-run")).resolves.toBeUndefined();
  });

  it("does not lose concurrent appends in one store instance", async () => {
    const records = Array.from({ length: 12 }, (_, index) =>
      historyRecord(`run-${index}`, "completed", `2026-10-01T00:00:${String(index).padStart(2, "0")}.000Z`),
    );

    await Promise.all(records.map((record) => store.append(record)));

    const saved = await store.readAll();
    expect(saved).toHaveLength(records.length);
    expect(saved.map((record) => record.id)).toEqual(
      [...records].sort((left, right) => left.endedAt.localeCompare(right.endedAt)).map((record) => record.id),
    );
  });

  it("replaces the snapshot with complete JSON and leaves no temporary file", async () => {
    await store.append(historyRecord("run-1", "completed", "2026-10-01T00:00:01.000Z"));
    await store.append(historyRecord("run-2", "completed", "2026-10-01T00:00:02.000Z"));

    const raw = await readFile(store.filePath, "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(JSON.parse(raw)).toMatchObject({ schemaVersion: 1, records: [{ id: "run-1" }, { id: "run-2" }] });
    await expect(readdir(temporaryDirectory)).resolves.toEqual(["experiments.json"]);
  });

  it("fails safely on malformed JSON and leaves it untouched", async () => {
    const malformed = "{ this is not valid JSON";
    await writeFile(store.filePath, malformed, "utf8");

    await expect(store.append(historyRecord("run-1", "completed", "2026-10-01T00:00:01.000Z")))
      .rejects.toMatchObject({ code: "invalid_snapshot" });
    await expect(readFile(store.filePath, "utf8")).resolves.toBe(malformed);
  });

  it.each([
    ["unsupported version", JSON.stringify({ schemaVersion: 3, records: [] }), "unsupported_schema"],
    ["unknown snapshot structure", JSON.stringify({ experiments: [] }), "unsupported_schema"],
    ["invalid record", JSON.stringify({ schemaVersion: 1, records: [{ id: "incomplete" }] }), "invalid_snapshot"],
  ] as const)("rejects %s and does not overwrite it", async (_label, contents, code) => {
    await writeFile(store.filePath, contents, "utf8");

    await expect(store.append(historyRecord("run-1", "completed", "2026-10-01T00:00:01.000Z")))
      .rejects.toMatchObject({ code });
    await expect(readFile(store.filePath, "utf8")).resolves.toBe(contents);
  });

  it("rejects evaluation without a scenario ID", async () => {
    const record = historyRecord("evaluated-run", "completed", "2026-10-01T00:00:01.000Z");

    expect(() => store.append({ ...record, evaluation: { passed: true, reason: "Expected result." } }))
      .toThrow(expect.objectContaining({ code: "invalid_snapshot" }));
  });

  it("stores comparison metadata in v2 and keeps existing v1 records readable without rewriting them", async () => {
    const first = historyRecord("legacy", "completed", "2026-10-01T00:00:01.000Z");
    await store.append(first);
    const comparisonRecord = {
      ...historyRecord("baseline-run", "completed", "2026-10-01T00:00:02.000Z"),
      schemaVersion: 2 as const,
      scenarioId: "direct-text",
      comparisonId: "comparison-1",
      configurationId: "baseline" as const,
    };
    await store.append(comparisonRecord);

    const snapshot = JSON.parse(await readFile(store.filePath, "utf8"));
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.records).toContainEqual(first);
    expect(snapshot.records).toContainEqual(comparisonRecord);
    await expect(store.getById("legacy")).resolves.toMatchObject({ schemaVersion: 1 });
  });

  it("rejects incomplete or unsupported comparison metadata", () => {
    const base = {
      ...historyRecord("comparison-run", "completed", "2026-10-01T00:00:01.000Z"),
      schemaVersion: 2 as const,
      scenarioId: "direct-text",
    };
    expect(() => store.append({ ...base, comparisonId: "comparison-1" }))
      .toThrow(expect.objectContaining({ code: "invalid_snapshot" }));
    expect(() => store.append({ ...base, comparisonId: "comparison-1", configurationId: "other" as "baseline" }))
      .toThrow(expect.objectContaining({ code: "invalid_snapshot" }));
  });

  it("rejects events whose experiment ID differs from the enclosing record", async () => {
    const record = historyRecord("outer-run", "completed", "2026-10-01T00:00:01.000Z");
    const mismatchedEvent = { ...record.events[0], experimentId: "other-run" };

    expect(() => store.append({ ...record, events: [mismatchedEvent] }))
      .toThrow(expect.objectContaining({ code: "invalid_snapshot" }));
  });

  it.each([
    ["evaluation without scenario ID", (record: ExperimentHistoryRecord) => ({
      ...record,
      evaluation: { passed: true, reason: "Expected result." },
    })],
    ["event with a different experiment ID", (record: ExperimentHistoryRecord) => ({
      ...record,
      events: [{ ...record.events[0], experimentId: "other-run" }],
    })],
  ])("rejects persisted records with %s when reading", async (_label, corruptRecord) => {
    const validRecord = historyRecord("stored-run", "completed", "2026-10-01T00:00:01.000Z");
    await writeFile(store.filePath, JSON.stringify({
      schemaVersion: 1,
      records: [corruptRecord(validRecord)],
    }), "utf8");

    await expect(store.listSummaries()).rejects.toMatchObject({ code: "invalid_snapshot" });
  });

  it("continues to read valid v1 records written by the v0.6.1 shape", async () => {
    const record = historyRecord("legacy-run", "completed", "2026-10-01T00:00:01.000Z");
    await writeFile(store.filePath, JSON.stringify({ schemaVersion: 1, records: [record] }), "utf8");

    await expect(store.getById("legacy-run")).resolves.toEqual(record);
  });

  it("stores only approved event fields", async () => {
    const record = historyRecord("run-1", "completed", "2026-10-01T00:00:01.000Z");
    const eventWithUnexpectedData = {
      ...record.events[0],
      apiKey: "private-key",
      toolInput: "private-input",
      previous_response_id: "private-continuation",
    } as unknown as typeof record.events[number];

    await store.append({ ...record, events: [eventWithUnexpectedData] });

    const serialized = JSON.stringify(await store.readAll());
    expect(serialized).not.toContain("private-key");
    expect(serialized).not.toContain("private-input");
    expect(serialized).not.toContain("private-continuation");
  });

  it("resolves the default path beneath LOCALAPPDATA on Windows", () => {
    expect(getDefaultExperimentHistoryPath(
      "win32",
      { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" } as unknown as NodeJS.ProcessEnv,
      "C:\\Users\\tester",
    ))
      .toBe(join("C:\\Users\\tester\\AppData\\Local", "AgentLab", "experiments.json"));
  });

  it("rejects duplicate experiment IDs instead of creating duplicate terminal records", async () => {
    const record = historyRecord("run-1", "completed", "2026-10-01T00:00:01.000Z");
    await store.append(record);

    await expect(store.append(record)).rejects.toBeInstanceOf(ExperimentHistoryError);
    await expect(store.readAll()).resolves.toHaveLength(1);
  });
});

function historyRecord(
  id: string,
  status: "completed" | "failed",
  endedAt: string,
): ExperimentHistoryRecord {
  return {
    schemaVersion: 1,
    id,
    task: "A local history task.",
    status,
    startedAt: "2026-10-01T00:00:00.000Z",
    endedAt,
    durationMs: 1000,
    ...(status === "completed"
      ? { output: { type: "text" as const, text: "Finished safely." } }
      : { errorMessage: "Agent görevi tamamlayamadı." }),
    events: [
      { experimentId: id, occurredAt: endedAt, type: "experiment.completed", endedAt, durationMs: 1000 },
    ],
  };
}
