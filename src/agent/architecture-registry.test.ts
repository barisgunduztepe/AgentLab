import { afterEach, describe, expect, it, vi } from "vitest";
import { ARCHITECTURE_DEFINITIONS, CONFIGURATION_IDS, COMPARISON_CONFIGURATION_IDS, isRunConfigurationId } from "./architecture-definitions";
import { createArchitectureRunner } from "./architecture-registry";
import { createProviderContext } from "./create-model-provider";
import { STRUCTURED_AGENT_INSTRUCTION } from "./single-agent";

afterEach(() => vi.unstubAllEnvs());
describe("architecture registry", () => {
  it("preserves identities, versions and the two comparison profiles", () => {
    expect(CONFIGURATION_IDS).toEqual(["baseline", "structured", "handoff-default", "single-critic-audit-v1"]);
    expect(COMPARISON_CONFIGURATION_IDS).toEqual(["baseline", "structured"]);
    expect(CONFIGURATION_IDS.map((id) => ARCHITECTURE_DEFINITIONS[id].version)).toEqual([1, 1, 1, 1]);
    expect(isRunConfigurationId("toString")).toBe(false);
  });
  it("runs each profile with independent providers and exact prompt wording", async () => {
    const prompts: string[] = [];
    const slots: string[] = [];
    for (const id of ["baseline", "structured", "handoff-default"] as const) {
      const runner = createArchitectureRunner(id, { createTools: () => [], createProviderFor(slot) {
        slots.push(slot); return { async complete(request) {
          prompts.push(request.messages.flatMap((m) => m.role === "user" ? [m.text] : [])[0]);
          return { type: "text", text: "Notes", finishReason: "stop", usage: null };
        } };
      } });
      await runner.run("Task");
    }
    expect(prompts.slice(0, 2)).toEqual(["Task", `Task\n\n${STRUCTURED_AGENT_INSTRUCTION}`]);
    expect(slots).toEqual(["primary", "primary", "analyst", "finalizer"]);
    expect(prompts[2]).toContain("Role: Analyst.");
    expect(prompts[3]).toContain("Analyst context:\n---\nNotes");
  });
  it("captures provider configuration once without exposing credentials", async () => {
    vi.stubEnv("AGENTLAB_MODEL_PROVIDER", "fake");
    const context = createProviderContext();
    vi.stubEnv("AGENTLAB_MODEL_PROVIDER", "invalid");
    const first = context.create(); const second = context.create();
    expect(first).not.toBe(second);
    expect(context.description).toEqual({ provider: "fake" });
    await expect(first.complete({ messages: [{ role: "user", text: "Task" }], tools: [] })).resolves.toMatchObject({ type: "text" });
  });
});
