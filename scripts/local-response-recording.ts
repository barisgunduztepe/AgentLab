import { DOCUMENT_CORPUS_VERSION } from "../src/tools/document-search-corpus";
import { ARCHITECTURE_DEFINITIONS } from "../src/agent/architecture-definitions";
import { getShortCommit } from "../src/experiments/run-metadata";

export function recordingProvenance(model: string, capturedAt: string, scenarioId?: string) {
  if (!scenarioId) return { source: "live-ollama-smoke", model, capturedAt, promptVersion: "bf220ed" };
  const commit = getShortCommit();
  return { source: "live-ollama-scenario-smoke", model, capturedAt, scenarioId, corpusVersion: DOCUMENT_CORPUS_VERSION,
    configurationId: "baseline", configurationVersion: ARCHITECTURE_DEFINITIONS.baseline.version,
    ...(commit ? { commit } : {}), promptVersion: "document-scenarios-v1" };
}

/** Allowlisted response snapshots only; never persist requests, headers or reasoning. */
export function sanitizeLocalResponse(raw: unknown, secrets: readonly string[] = [], ordinal = 1) {
  const clean = (value: unknown): string => {
    let text = typeof value === "string" ? value : "";
    // Some servers put reasoning inline instead of in a separate reasoning field.
    text = text.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "").replace(/<think\b[^>]*>[\s\S]*$/gi, "");
    for (const secret of secrets.filter(Boolean)) text = text.split(secret).join("[redacted]");
    return text.replace(/https?:\/\/[^\s"<>]+/gi, "[address]").trim();
  };
  if (typeof raw !== "object" || raw === null) throw new Error("Invalid recorded response.");
  const body = raw as Record<string, unknown>;
  if (!Array.isArray(body.choices)) throw new Error("Invalid recorded choices.");
  return {
    id: "recorded-completion", object: "chat.completion", created: 0,
    choices: body.choices.map((value, index) => {
      const choice = value as Record<string, unknown>;
      const message = choice.message as Record<string, unknown>;
      if (!message || message.role !== "assistant") throw new Error("Invalid recorded message.");
      return { index, finish_reason: clean(choice.finish_reason), message: {
        role: "assistant", content: message.content === null ? null : clean(message.content),
        ...(Array.isArray(message.tool_calls) ? { tool_calls: message.tool_calls.map((value, callIndex) => {
          const call = value as { type?: unknown; function?: { name?: unknown; arguments?: unknown } };
          return { id: `recorded-call-${ordinal}-${callIndex + 1}`, type: clean(call.type),
            function: { name: clean(call.function?.name), arguments: clean(call.function?.arguments) } };
        }) } : {}),
      } };
    }),
    ...(typeof body.usage === "object" && body.usage !== null ? { usage: Object.fromEntries(
      ["prompt_tokens", "completion_tokens", "total_tokens"].flatMap((key) => {
        const value = (body.usage as Record<string, unknown>)[key];
        return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? [[key, value]] : [];
      }),
    ) } : {}),
  };
}

export interface LocalResponseRecording {
  scenario: string;
  response: ReturnType<typeof sanitizeLocalResponse>;
}
