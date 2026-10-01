import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExperimentHistoryStore,
  type ExperimentHistoryRecord,
} from "../../../../experiments/experiment-history";
import { createHistoryReadHandlers } from "./history-read-handlers";

let temporaryDirectory: string;
let store: ExperimentHistoryStore;
let handlers: ReturnType<typeof createHistoryReadHandlers>;

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "agentlab-history-read-"));
  store = new ExperimentHistoryStore(join(temporaryDirectory, "experiments.json"));
  handlers = createHistoryReadHandlers(store);
});

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

function localRequest(host = "localhost:3000", extraHeaders: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/experiments/history", {
    headers: { host, ...extraHeaders },
  });
}

function record(id: string, endedAt: string): ExperimentHistoryRecord {
  return {
    schemaVersion: 1,
    id,
    task: `Task ${id}`,
    status: "completed",
    startedAt: "2026-10-01T00:00:00.000Z",
    endedAt,
    durationMs: 1000,
    output: { type: "text", text: `Result ${id}` },
    events: [{ experimentId: id, occurredAt: endedAt, type: "experiment.completed", endedAt, durationMs: 1000 }],
  };
}

describe("history read handlers", () => {
  it("returns an empty list when history does not exist", async () => {
    const response = await handlers.list(localRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ experiments: [] });
  });

  it("returns summary-only records newest first", async () => {
    await store.append(record("older", "2026-10-01T00:00:01.000Z"));
    await store.append(record("newer", "2026-10-01T00:00:02.000Z"));

    const response = await handlers.list(localRequest());
    const body = await response.json();

    expect(body.experiments.map((item: { id: string }) => item.id)).toEqual(["newer", "older"]);
    expect(body.experiments[0]).not.toHaveProperty("events");
    expect(body.experiments[0]).not.toHaveProperty("output");
  });

  it("returns one full validated record by ID", async () => {
    const saved = record("detail-1", "2026-10-01T00:00:01.000Z");
    await store.append(saved);

    const response = await handlers.detail(localRequest(), saved.id);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(saved);
  });

  it("returns a safe 404 for an unknown ID", async () => {
    const response = await handlers.detail(localRequest(), "missing-id");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Experiment not found." });
  });

  it.each(["localhost", "localhost:3000", "127.0.0.1", "127.0.0.1:3000", "[::1]:3000"])(
    "accepts intended loopback Host form %s",
    async (host) => {
      const response = await handlers.list(localRequest(host));
      expect(response.status).toBe(200);
    },
  );

  it("rejects non-loopback Host even when forwarded headers claim localhost", async () => {
    const listSummaries = vi.spyOn(store, "listSummaries");

    const response = await handlers.list(localRequest("192.168.1.20:3000", {
      "x-forwarded-host": "localhost:3000",
      "x-forwarded-for": "127.0.0.1",
    }));

    expect(response.status).toBe(403);
    expect(listSummaries).not.toHaveBeenCalled();
  });

  it("does not treat forwarded headers as client identity", async () => {
    const response = await handlers.list(localRequest("localhost:3000", {
      "x-forwarded-host": "outside.example",
      "x-forwarded-for": "203.0.113.40",
    }));

    expect(response.status).toBe(200);
  });

  it.each([
    ["malformed JSON", "{broken"],
    ["unsupported schema", JSON.stringify({ schemaVersion: 9, records: [] })],
  ])("returns a generic safe error for %s", async (_label, contents) => {
    await writeFile(store.filePath, contents, "utf8");

    const response = await handlers.list(localRequest());
    const body = await response.text();
    const detailResponse = await handlers.detail(localRequest(), "any-id");
    const detailBody = await detailResponse.text();

    expect(response.status).toBe(500);
    expect(body).toBe(JSON.stringify({ error: "Experiment history is unavailable." }));
    expect(body).not.toContain(temporaryDirectory);
    expect(detailResponse.status).toBe(500);
    expect(detailBody).toBe(JSON.stringify({ error: "Experiment history is unavailable." }));
    expect(detailBody).not.toContain(temporaryDirectory);
  });

  it("does not disclose filesystem details when reading fails", async () => {
    const unavailableStore = {
      listSummaries: async () => { throw new Error(temporaryDirectory); },
      getById: async () => { throw new Error(temporaryDirectory); },
    };
    const unavailableHandlers = createHistoryReadHandlers(unavailableStore);

    const listResponse = await unavailableHandlers.list(localRequest());
    const detailResponse = await unavailableHandlers.detail(localRequest(), "any-id");

    expect(listResponse.status).toBe(500);
    expect(detailResponse.status).toBe(500);
    expect(await listResponse.text()).not.toContain(temporaryDirectory);
    expect(await detailResponse.text()).not.toContain(temporaryDirectory);
  });
});
