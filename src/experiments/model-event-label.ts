import type { ExperimentEvent } from "./types";

/** Old absent measurements are different from explicitly unknown values and measured zero. */
export function modelMeasurementLabel(event: Extract<ExperimentEvent, { type: "model.responded" }>): string {
  const finish = event.finishReason === undefined ? "Kaydedilmemiş" : event.finishReason === "unknown" ? "Bilinmiyor" : event.finishReason;
  const usage = event.usage === undefined ? "Kaydedilmemiş" : event.usage === null ? "Bilinmiyor" :
    `${event.usage.inputTokens ?? "Bilinmiyor"}/${event.usage.outputTokens ?? "Bilinmiyor"}/${event.usage.totalTokens ?? "Bilinmiyor"}`;
  return `finish: ${finish} · tokens (in/out/total): ${usage}`;
}
