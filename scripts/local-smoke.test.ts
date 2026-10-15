import { describe, expect, it } from "vitest";
import { probeLocalEndpoint, requireLocalEndpoint, runLocalSmoke } from "./local-smoke";

const config = { baseURL: "http://127.0.0.1:11434/v1", model: "mock-model" };
function text(content: string) { return { choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }] }; }
function tool(id: string, expression: string) { return { choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null,
  tool_calls: [{ id, type: "function", function: { name: "calculator", arguments: JSON.stringify({ expression }) } }] } }] }; }

describe("manual smoke harness with mocked transport only", () => {
  it.each(["https://api.openai.com/v1", "https://remote.example/v1", "http://user:secret@localhost/v1", "http://localhost/v1?key=secret"])
    ("rejects nonlocal or credential-bearing destinations before network access", (url) => expect(() => requireLocalEndpoint(url)).toThrow());
  it("does not generate or download a missing model", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async (url) => { calls++; expect(String(url)).toBe(`${config.baseURL}/models`); return Response.json({ data: [] }); };
    expect(await probeLocalEndpoint(config, fetcher)).toEqual({ ready: false, reason: "model_not_installed" }); expect(calls).toBe(1);
  });
  it("recognizes an installed model without a generation request", async () => {
    const fetcher: typeof fetch = async () => Response.json({ data: [{ id: "mock-model" }] });
    expect(await probeLocalEndpoint(config, fetcher)).toEqual({ ready: true, reason: "installed_model_available" });
  });
  it("reports an unreachable endpoint safely", async () => {
    const fetcher: typeof fetch = async () => { throw new Error("private address/key"); };
    expect(await probeLocalEndpoint(config, fetcher)).toEqual({ ready: false, reason: "endpoint_unreachable" });
  });
  it("runs text, two actual calculator turns and transport cancellation without history writes or content logs", async () => {
    const fetcher: typeof fetch = async (url, init) => {
      const req = new Request(url, init); const body = await req.json() as { messages: { role: string; content?: string }[] };
      const prompt = body.messages[0].content ?? "";
      if (prompt.startsWith("Explain in one")) return Response.json(text("A thermostat controls temperature."));
      if (prompt.startsWith("Use the calculator")) {
        const count = body.messages.filter((m) => m.role === "tool").length;
        return Response.json(count === 0 ? tool("private-first", "17 * 23") : count === 1 ? tool("private-second", "391 + 19") : text("The result is 410."));
      }
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => { req.signal.removeEventListener("abort", abort); reject(new DOMException("private cancellation", "AbortError")); };
        req.signal.addEventListener("abort", abort, { once: true });
      });
    };
    const report = await runLocalSmoke(config, fetcher, { timeoutMs: 1000, cancellationDelayMs: 1 });
    expect(report).toMatchObject({ ok: true, historyWritten: false });
    expect(report.scenarios.map((s) => s.scenario)).toEqual(["text", "calculator-two-turns", "cancellation"]);
    expect(report.scenarios[1].eventSummary["tool.completed"]).toBe(2);
    expect(report.scenarios[2]).toMatchObject({ failureCode: "cancelled", transportAborted: true });
    for (const secret of ["private", "391 + 19", "controls temperature", "127.0.0.1"]) expect(JSON.stringify(report)).not.toContain(secret);
  });
  it("stops after unexpected model behavior instead of fabricating a successful run", async () => {
    const fetcher: typeof fetch = async () => Response.json(text(""));
    const report = await runLocalSmoke(config, fetcher, { timeoutMs: 1000 });
    expect(report.ok).toBe(false); expect(report.scenarios).toHaveLength(1);
  });
});
