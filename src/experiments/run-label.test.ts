import { describe, expect, it } from "vitest";
import { describeRunForDisplay } from "./run-label";

describe("describeRunForDisplay", () => {
  it("marks fake runs clearly and shows the agent configuration and commit", () => {
    expect(describeRunForDisplay({
      provider: "fake",
      architecture: "single",
      agentConfigurationId: "baseline",
      agentConfigurationVersion: 1,
      commit: "0aa5360",
    })).toEqual({
      isFake: true,
      badge: "FAKE",
      provider: "FAKE provider",
      description: "FAKE provider · single · baseline v1 · commit 0aa5360",
    });
  });

  it("shows the provider and model for real runs without a fake marker", () => {
    expect(describeRunForDisplay({
      provider: "gemini",
      model: "example-model",
      architecture: "handoff",
      agentConfigurationId: "handoff-default",
      agentConfigurationVersion: 2,
    })).toEqual({
      isFake: false,
      badge: "gemini",
      provider: "gemini · example-model",
      description: "gemini · example-model · handoff · handoff-default v2",
    });
  });

  it("does not invent a provider for records saved before run metadata", () => {
    const label = describeRunForDisplay(undefined);

    expect(label.isFake).toBe(false);
    expect(label.badge).toBe("");
    expect(label.description).toContain("not recorded");
  });
});
