import OpenAI from "openai";
import { OpenAICompatibleModelProvider, getOpenAICompatibleConfiguration, type OpenAICompatibleConfiguration } from "../src/agent/providers/openai-compatible-model-provider";
import { RetryingModelProvider } from "../src/agent/providers/retrying-model-provider";
import { SingleAgent } from "../src/agent/single-agent";
import { CalculatorTool } from "../src/tools/calculator-tool";
import { runExperiment } from "../src/experiments/run-experiment";
import type { ExperimentEvent } from "../src/experiments/types";
import { sanitizeLocalResponse, type LocalResponseRecording } from "./local-response-recording";

export function requireLocalEndpoint(baseURL: string): void {
  const url = new URL(baseURL);
  if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash) throw new Error("Smoke requires a loopback endpoint.");
}

export async function probeLocalEndpoint(config: OpenAICompatibleConfiguration, transport: typeof fetch = fetch): Promise<{ ready: boolean; reason: string }> {
  requireLocalEndpoint(config.baseURL);
  try {
    const response = await transport(`${config.baseURL.replace(/\/+$/, "")}/models`, {
      signal: AbortSignal.timeout(5000), redirect: "error",
      ...(config.apiKey ? { headers: { Authorization: `Bearer ${config.apiKey}` } } : {}),
    });
    if (!response.ok) return { ready: false, reason: "models_unavailable" };
    const body = await response.json() as { data?: { id?: string }[] };
    const installed = Array.isArray(body.data) && body.data.some((model) => model.id === config.model);
    return { ready: installed, reason: installed ? "installed_model_available" : "model_not_installed" };
  } catch { return { ready: false, reason: "endpoint_unreachable" }; }
}

/** Executes only when called by the manual runner; importing this module never calls a model. */
export async function runLocalSmoke(config: OpenAICompatibleConfiguration, transport: typeof fetch = fetch,
  options: { timeoutMs?: number; cancellationDelayMs?: number; record?: (snapshot: LocalResponseRecording) => void } = {}) {
  requireLocalEndpoint(config.baseURL);
  config = getOpenAICompatibleConfiguration({ OPENAI_COMPATIBLE_BASE_URL: config.baseURL,
    OPENAI_COMPATIBLE_MODEL: config.model, OPENAI_COMPATIBLE_API_KEY: config.apiKey });
  const scenarios = [
    { id: "text", task: "Explain in one short sentence what a thermostat does." },
    { id: "calculator-two-turns", task: "Use the calculator tool, one call per response. First call it only for 17 * 23 and wait for the tool result. After you receive that result, make a second, separate calculator call that adds 19 to it. Never make two calls in the same response and never compute anything yourself. After both tool results, report the final value." },
    { id: "cancellation", task: "Explain the history of navigation in several paragraphs." },
  ];
  const results = [];
  for (const scenario of scenarios) {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
    const events: ExperimentEvent[] = [];
    let dispatched = 0;
    let transportAborted = false;
    const removeTransportListeners: (() => void)[] = [];
    let cancelTimer: ReturnType<typeof setTimeout> | undefined;
    const observedFetch: typeof fetch = async (url, init) => {
      const req = new Request(url, init);
      // No redirects to a cloud endpoint or another service in a local smoke run.
      if (req.url !== `${config.baseURL.replace(/\/+$/, "")}/chat/completions`) throw new Error("Unexpected smoke request.");
      dispatched += 1;
      const onAbort = () => { transportAborted = true; };
      req.signal.addEventListener("abort", onAbort, { once: true });
      removeTransportListeners.push(() => req.signal.removeEventListener("abort", onAbort));
      const pending = transport(req, { redirect: "error" });
      if (scenario.id === "cancellation") cancelTimer = setTimeout(() => controller.abort(), options.cancellationDelayMs ?? 10);
      const response = await pending;
      if (options.record && response.ok) {
        const snapshot = sanitizeLocalResponse(await response.clone().json(), [config.baseURL, config.apiKey ?? ""], dispatched);
        options.record({ scenario: scenario.id, response: snapshot });
      }
      return response;
    };
    const client = new OpenAI({ baseURL: config.baseURL, apiKey: config.apiKey ?? "agentlab-local-no-key", maxRetries: 0,
      adminAPIKey: null, organization: null, project: null, fetch: observedFetch,
      ...(!config.apiKey ? { defaultHeaders: { Authorization: null } } : {}),
    });
    const provider = new RetryingModelProvider(new OpenAICompatibleModelProvider(config, client));
    const tools = scenario.id === "calculator-two-turns" ? [new CalculatorTool()] : [];
    try {
      const experiment = await runExperiment(scenario.task, new SingleAgent(provider, tools), (event) => events.push(event), { signal: controller.signal });
      const modelEvents = events.filter((e) => e.type === "model.responded");
      const toolCount = events.filter((e) => e.type === "tool.completed").length;
      const ok = scenario.id === "cancellation"
        ? experiment.failureCode === "cancelled" && dispatched > 0 && transportAborted && modelEvents.length === 1 && modelEvents[0].outcome === "error"
        : experiment.status === "completed" && !!experiment.output?.text.trim() && modelEvents.length > 0 && dispatched > 0 &&
          (scenario.id !== "calculator-two-turns" || (toolCount >= 2 && /\b410\b/.test(experiment.output?.text ?? "")));
      const last = modelEvents.at(-1);
      results.push({ scenario: scenario.id, ok, status: experiment.status,
        ...(experiment.failureCode ? { failureCode: experiment.failureCode } : {}),
        durationMs: experiment.durationMs, finishReason: last?.finishReason ?? "unknown", usage: last?.usage ?? null,
        modelCalls: modelEvents.map((event) => ({ outcome: event.outcome, durationMs: event.durationMs, finishReason: event.finishReason, usage: event.usage })),
        eventSummary: events.reduce<Record<string, number>>((counts, event) => { counts[event.type] = (counts[event.type] ?? 0) + 1; return counts; }, {}),
        transportRequests: dispatched, transportAborted,
      });
      if (!ok) break; // Unexpected live behavior is reported; never change the prompt/model and try again silently.
    } finally {
      clearTimeout(deadline);
      if (cancelTimer !== undefined) clearTimeout(cancelTimer);
      for (const remove of removeTransportListeners) remove();
    }
  }
  return { provider: "openai-compatible", model: config.model, historyWritten: false,
    ok: results.length === scenarios.length && results.every((result) => result.ok), scenarios: results };
}
