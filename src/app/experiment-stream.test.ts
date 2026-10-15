import { describe, expect, it, vi } from "vitest";
import { readEventStream } from "./experiment-stream";
import { wantsEventStream } from "./api/experiments/compare/wants-event-stream";
import { applyComparisonFrame } from "./comparison-progress";
describe("POST event streams", () => {
  it.each([null, "*/*", "application/json", "text/event-stream;q=0", "text/event-stream; q=0.000"])("keeps JSON for %s", (header) => expect(wantsEventStream(header)).toBe(false));
  it.each(["text/event-stream", "application/json, text/event-stream", "TEXT/EVENT-STREAM;q=0.5"])("opts into SSE for %s", (header) => expect(wantsEventStream(header)).toBe(true));
  it("decodes fragmented UTF8, split CRLF, multiline data and the final buffer", async () => {
    const bytes = new TextEncoder().encode('data: {"text":\r\ndata: "İstanbul"}\r\n\r\ndata: {"done":true}');
    const values: unknown[] = [];
    const response = new Response(new ReadableStream({ start(out) { for (const byte of bytes) out.enqueue(new Uint8Array([byte])); out.close(); } }));
    await readEventStream(response, new AbortController().signal, (event) => values.push(event));
    expect(values).toEqual([{ text: "İstanbul" }, { done: true }]);
  });
  it("cancels the reader on malformed data", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ start(out) { out.enqueue(new TextEncoder().encode('data: invalid\n\n')); }, cancel }));
    await expect(readEventStream(response, new AbortController().signal, () => undefined)).rejects.toThrow();
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("rejects a frame from a different comparison instead of corrupting partial rows", () => {
    expect(() => applyComparisonFrame({ comparisonId: "one", scenarioId: "direct-text", rows: [], finished: false },
      { type: "comparison.finished", outcome: "completed", result: { comparisonId: "two", scenarioId: "direct-text", runs: [] } })).toThrow();
  });
});
