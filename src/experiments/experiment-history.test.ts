import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
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
    ["unsupported version", JSON.stringify({ schemaVersion: 4, records: [] }), "unsupported_schema"],
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

  describe("v3 run metadata", () => {
    const fakeRun = {
      provider: "fake" as const,
      architecture: "single" as const,
      agentConfigurationId: "baseline" as const,
      agentConfigurationVersion: 1,
    };
    const v3Record = (id: string, endedAt: string, overrides: Partial<ExperimentHistoryRecord> = {}): ExperimentHistoryRecord => ({
      ...historyRecord(id, "completed", endedAt),
      schemaVersion: 3,
      run: fakeRun,
      ...overrides,
    });

    it("stores a non-comparison v3 record, keeps v1/v2 records untouched, and raises the snapshot to v3", async () => {
      const legacy = historyRecord("legacy", "completed", "2026-10-01T00:00:01.000Z");
      const comparison = {
        ...historyRecord("compared", "completed", "2026-10-01T00:00:02.000Z"),
        schemaVersion: 2 as const,
        scenarioId: "direct-text",
        comparisonId: "comparison-1",
        configurationId: "baseline" as const,
      };
      const current = v3Record("current", "2026-10-01T00:00:03.000Z");
      await store.append(legacy);
      await store.append(comparison);
      await store.append(current);

      const snapshot = JSON.parse(await readFile(store.filePath, "utf8"));
      expect(snapshot.schemaVersion).toBe(3);
      expect(snapshot.records).toContainEqual(legacy);
      expect(snapshot.records).toContainEqual(comparison);
      expect(snapshot.records).toContainEqual(current);
      await expect(store.getById("legacy")).resolves.not.toHaveProperty("run");
      await expect(store.getById("current")).resolves.toMatchObject({ schemaVersion: 3, run: fakeRun });
    });

    it("stores v3 comparison fields only together and consistent with the run configuration", async () => {
      const comparison = v3Record("baseline-run", "2026-10-01T00:00:01.000Z", {
        scenarioId: "direct-text",
        comparisonId: "comparison-1",
        configurationId: "baseline",
      });
      await store.append(comparison);
      await expect(store.getById("baseline-run")).resolves.toEqual(comparison);

      expect(() => store.append(v3Record("only-id", "2026-10-01T00:00:02.000Z", { comparisonId: "comparison-1" })))
        .toThrow(expect.objectContaining({ code: "invalid_snapshot" }));
      expect(() => store.append(v3Record("only-config", "2026-10-01T00:00:03.000Z", { configurationId: "baseline" })))
        .toThrow(expect.objectContaining({ code: "invalid_snapshot" }));
      expect(() => store.append(v3Record("mismatch", "2026-10-01T00:00:04.000Z", {
        comparisonId: "comparison-1",
        configurationId: "structured",
      }))).toThrow(expect.objectContaining({ code: "invalid_snapshot" }));
    });

    it("accepts real providers with a model and an optional short commit", async () => {
      const run = {
        provider: "openai" as const,
        model: "example-model",
        architecture: "handoff" as const,
        agentConfigurationId: "handoff-default" as const,
        agentConfigurationVersion: 2,
        commit: "0aa5360",
      };
      const record = v3Record("real-run", "2026-10-01T00:00:01.000Z", { run });
      await store.append(record);

      await expect(store.getById("real-run")).resolves.toMatchObject({ run });
    });

    it.each([
      ["missing run", (record: ExperimentHistoryRecord) => ({ ...record, run: undefined })],
      ["run on a v2 record", (record: ExperimentHistoryRecord) => ({
        ...record, schemaVersion: 2 as const, comparisonId: "comparison-1", configurationId: "baseline" as const,
      })],
      ["run on a v1 record", (record: ExperimentHistoryRecord) => ({ ...record, schemaVersion: 1 as const })],
      ["unknown provider", (record: ExperimentHistoryRecord) => ({ ...record, run: { ...fakeRun, provider: "groq" as "fake" } })],
      ["fake provider with a model", (record: ExperimentHistoryRecord) => ({ ...record, run: { ...fakeRun, model: "m" } })],
      ["real provider without a model", (record: ExperimentHistoryRecord) => ({
        ...record, run: { ...fakeRun, provider: "gemini" as const },
      })],
      ["mismatched architecture and configuration", (record: ExperimentHistoryRecord) => ({
        ...record, run: { ...fakeRun, agentConfigurationId: "handoff-default" as const },
      })],
      ["non-integer configuration version", (record: ExperimentHistoryRecord) => ({
        ...record, run: { ...fakeRun, agentConfigurationVersion: 1.5 },
      })],
      ["zero configuration version", (record: ExperimentHistoryRecord) => ({
        ...record, run: { ...fakeRun, agentConfigurationVersion: 0 },
      })],
      ["malformed commit", (record: ExperimentHistoryRecord) => ({ ...record, run: { ...fakeRun, commit: "not a sha" } })],
    ])("rejects %s", (_label, corrupt) => {
      const record = v3Record("bad-run", "2026-10-01T00:00:01.000Z");

      expect(() => store.append(corrupt(record) as ExperimentHistoryRecord))
        .toThrow(expect.objectContaining({ code: "invalid_snapshot" }));
    });

    it("drops unknown run fields when saving and rejects them when reading", async () => {
      const withExtra = {
        ...v3Record("extra-run", "2026-10-01T00:00:01.000Z"),
        run: { ...fakeRun, apiKey: "private-key", baseUrl: "http://private.example" },
      } as unknown as ExperimentHistoryRecord;
      await store.append(withExtra);

      const raw = await readFile(store.filePath, "utf8");
      expect(raw).not.toContain("private-key");
      expect(raw).not.toContain("private.example");

      await writeFile(store.filePath, JSON.stringify({ schemaVersion: 3, records: [withExtra] }), "utf8");
      await expect(store.readAll()).rejects.toMatchObject({ code: "invalid_snapshot" });
    });

    it("rejects a record newer than its snapshot when reading", async () => {
      const record = v3Record("too-new", "2026-10-01T00:00:01.000Z");
      await writeFile(store.filePath, JSON.stringify({ schemaVersion: 2, records: [record] }), "utf8");

      await expect(store.readAll()).rejects.toMatchObject({ code: "invalid_snapshot" });
    });

    it("includes run metadata in summaries only when recorded", async () => {
      await store.append(historyRecord("legacy", "completed", "2026-10-01T00:00:01.000Z"));
      await store.append(v3Record("current", "2026-10-01T00:00:02.000Z"));

      const summaries = await store.listSummaries();
      expect(summaries.find(({ id }) => id === "current")).toMatchObject({ run: fakeRun });
      expect(summaries.find(({ id }) => id === "legacy")).not.toHaveProperty("run");
    });
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
      .toBe(win32.join("C:\\Users\\tester\\AppData\\Local", "AgentLab", "experiments.json"));
  });

  it("resolves the default path with POSIX rules on Linux regardless of the host", () => {
    expect(getDefaultExperimentHistoryPath(
      "linux",
      { XDG_DATA_HOME: "/data/xdg" } as unknown as NodeJS.ProcessEnv,
      "/home/tester",
    )).toBe("/data/xdg/AgentLab/experiments.json");

    expect(getDefaultExperimentHistoryPath(
      "linux",
      { XDG_DATA_HOME: "relative/path" } as unknown as NodeJS.ProcessEnv,
      "/home/tester",
    )).toBe("/home/tester/.local/share/AgentLab/experiments.json");
  });

  describe("model call events", () => {
    const at = "2026-10-01T00:00:01.000Z";
    const recordWith = (...events: unknown[]): ExperimentHistoryRecord => ({
      ...historyRecord("model-run", "completed", at),
      events: events.map((event) => ({ experimentId: "model-run", occurredAt: at, ...(event as object) })) as
        ExperimentHistoryRecord["events"],
    });

    it("stores model.requested and model.responded events with and without an agent", async () => {
      const record = recordWith(
        { type: "model.requested", purpose: "initial" },
        { type: "model.responded", outcome: "tool_call", durationMs: 12 },
        { type: "model.requested", purpose: "after_tool", agentId: "analyst" },
        { type: "model.responded", outcome: "text", durationMs: 0, agentId: "analyst" },
        { type: "model.responded", outcome: "error", durationMs: 3, agentId: "finalizer" },
      );
      await store.append(record);

      await expect(store.getById("model-run")).resolves.toEqual(record);
    });

    it.each([
      ["unknown purpose", { type: "model.requested", purpose: "retry" }],
      ["missing purpose", { type: "model.requested" }],
      ["unknown outcome", { type: "model.responded", outcome: "refusal", durationMs: 1 }],
      ["negative duration", { type: "model.responded", outcome: "text", durationMs: -1 }],
      ["non-numeric duration", { type: "model.responded", outcome: "text", durationMs: "5" }],
      ["non-finite duration", { type: "model.responded", outcome: "text", durationMs: Number.POSITIVE_INFINITY }],
      ["unknown agent", { type: "model.requested", purpose: "initial", agentId: "critic" }],
    ])("rejects %s", async (_label, event) => {
      expect(() => store.append(recordWith(event))).toThrow(expect.objectContaining({ code: "invalid_snapshot" }));

      await writeFile(store.filePath, JSON.stringify({ schemaVersion: 1, records: [recordWith(event)] }), "utf8");
      await expect(store.readAll()).rejects.toMatchObject({ code: "invalid_snapshot" });
    });

    it("drops unexpected fields such as prompt text when saving and rejects them when reading", async () => {
      const leaky = recordWith(
        { type: "model.requested", purpose: "initial", prompt: "private prompt", apiKey: "private-key" },
        { type: "model.responded", outcome: "text", durationMs: 4, text: "private answer" },
      );
      await store.append(leaky);

      const raw = await readFile(store.filePath, "utf8");
      for (const secret of ["private prompt", "private-key", "private answer"]) expect(raw).not.toContain(secret);

      await writeFile(store.filePath, JSON.stringify({ schemaVersion: 1, records: [leaky] }), "utf8");
      await expect(store.readAll()).rejects.toMatchObject({ code: "invalid_snapshot" });
    });
  });

  describe("failure codes on experiment.failed events", () => {
    const failedRecord = (failureCode?: unknown): ExperimentHistoryRecord => {
      const endedAt = "2026-10-01T00:00:01.000Z";
      const base = historyRecord("failed-run", "failed", endedAt);
      return {
        ...base,
        events: [{
          experimentId: "failed-run",
          occurredAt: endedAt,
          type: "experiment.failed",
          endedAt,
          durationMs: 1000,
          errorMessage: "Agent görevi tamamlayamadı.",
          ...(failureCode === undefined ? {} : { failureCode }),
        } as ExperimentHistoryRecord["events"][number]],
      };
    };

    it("keeps a valid failure code when saving and reading", async () => {
      await store.append(failedRecord("tool_unavailable"));

      const [saved] = await store.readAll();
      expect(saved.events[0]).toMatchObject({ type: "experiment.failed", failureCode: "tool_unavailable" });
    });

    it("still reads failed events saved before failure codes existed", async () => {
      await writeFile(store.filePath, JSON.stringify({ schemaVersion: 1, records: [failedRecord()] }), "utf8");

      const [saved] = await store.readAll();
      expect(saved.events[0]).not.toHaveProperty("failureCode");
    });

    it.each(["agent_execution_failed", "", 7, null])("rejects an unknown failure code %s", async (code) => {
      expect(() => store.append(failedRecord(code))).toThrow(expect.objectContaining({ code: "invalid_snapshot" }));

      await writeFile(store.filePath, JSON.stringify({ schemaVersion: 1, records: [failedRecord(code)] }), "utf8");
      await expect(store.readAll()).rejects.toMatchObject({ code: "invalid_snapshot" });
    });
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
