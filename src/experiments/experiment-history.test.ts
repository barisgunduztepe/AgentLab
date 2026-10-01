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
    ["unsupported version", JSON.stringify({ schemaVersion: 2, records: [] }), "unsupported_schema"],
    ["unknown snapshot structure", JSON.stringify({ experiments: [] }), "unsupported_schema"],
    ["invalid record", JSON.stringify({ schemaVersion: 1, records: [{ id: "incomplete" }] }), "invalid_snapshot"],
  ] as const)("rejects %s and does not overwrite it", async (_label, contents, code) => {
    await writeFile(store.filePath, contents, "utf8");

    await expect(store.append(historyRecord("run-1", "completed", "2026-10-01T00:00:01.000Z")))
      .rejects.toMatchObject({ code });
    await expect(readFile(store.filePath, "utf8")).resolves.toBe(contents);
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
