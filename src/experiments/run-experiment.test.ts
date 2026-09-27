import { describe, expect, it } from "vitest";
import type { ModelProvider } from "../agent/model-provider";
import { SingleAgent } from "../agent/single-agent";
import { runExperiment } from "./run-experiment";
import type { ExperimentEvent } from "./types";

describe("runExperiment", () => {
  it("completes an experiment and emits its lifecycle events in order", async () => {
    const task = "Check the successful experiment flow.";
    const output = "Experiment result.";
    const modelProvider: ModelProvider = {
      async generateText() {
        return output;
      },
    };
    const events: ExperimentEvent[] = [];

    const experiment = await runExperiment(
      task,
      new SingleAgent(modelProvider),
      (event) => events.push(event),
    );

    expect(experiment.status).toBe("completed");
    expect(experiment.output).toBe(output);
    expect(experiment.startedAt).toBeTruthy();
    expect(Date.parse(experiment.startedAt)).not.toBeNaN();
    expect(experiment.endedAt).toBeTruthy();
    expect(Date.parse(experiment.endedAt ?? "")).not.toBeNaN();
    expect(experiment.durationMs).toEqual(expect.any(Number));
    expect(experiment.durationMs).toBeGreaterThanOrEqual(0);
    expect(events.map((event) => event.type)).toEqual([
      "experiment.started",
      "agent.started",
      "agent.completed",
      "experiment.completed",
    ]);
    expect(events[2]).toMatchObject({ type: "agent.completed", output });
    expect(events[3]).toMatchObject({
      type: "experiment.completed",
      endedAt: experiment.endedAt,
      durationMs: experiment.durationMs,
    });
  });

  it("returns a safe failed result without leaking provider error details", async () => {
    const rawProviderError = "private provider response and credential details";
    const modelProvider: ModelProvider = {
      async generateText() {
        throw new Error(rawProviderError);
      },
    };
    const events: ExperimentEvent[] = [];

    const experiment = await runExperiment(
      "Check the failed experiment flow.",
      new SingleAgent(modelProvider),
      (event) => events.push(event),
    );

    expect(experiment.status).toBe("failed");
    expect(experiment.errorMessage).toBe("Agent görevi tamamlayamadı.");
    expect(experiment.errorMessage).not.toContain(rawProviderError);
    expect(JSON.stringify(experiment)).not.toContain(rawProviderError);
    expect(events.map((event) => event.type)).toEqual([
      "experiment.started",
      "agent.started",
      "experiment.failed",
    ]);
    expect(events[2]).toMatchObject({
      type: "experiment.failed",
      errorMessage: "Agent görevi tamamlayamadı.",
    });
    expect(JSON.stringify(events)).not.toContain(rawProviderError);
  });
});
