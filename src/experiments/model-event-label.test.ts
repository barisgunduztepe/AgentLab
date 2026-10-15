import { describe, expect, it } from "vitest";
import { modelMeasurementLabel } from "./model-event-label";
import type { ExperimentEvent } from "./types";

describe("model measurement display", () => {
  const base: Extract<ExperimentEvent, { type: "model.responded" }> = {
    experimentId: "one", occurredAt: "2026-10-15T00:00:00.000Z", type: "model.responded", outcome: "text", durationMs: 1,
  };
  it("distinguishes old absent measurements, explicit unknowns, partial counts and zero", () => {
    expect(modelMeasurementLabel(base)).toContain("Kaydedilmemiş");
    expect(modelMeasurementLabel({ ...base, finishReason: "unknown", usage: null })).toBe("finish: Bilinmiyor · tokens (in/out/total): Bilinmiyor");
    expect(modelMeasurementLabel({ ...base, finishReason: "stop", usage: { inputTokens: 0, outputTokens: 2, totalTokens: null } }))
      .toBe("finish: stop · tokens (in/out/total): 0/2/Bilinmiyor");
  });
});
