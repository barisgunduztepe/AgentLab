import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENT_CONFIGURATION_VERSIONS, createRunMetadata, getShortCommit } from "./run-metadata";

const envNames = ["AGENTLAB_MODEL_PROVIDER", "OPENAI_API_KEY", "OPENAI_MODEL", "GEMINI_API_KEY", "GEMINI_MODEL"] as const;
const previousEnv = new Map(envNames.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of envNames) {
    const previousValue = previousEnv.get(name);
    if (previousValue === undefined) delete process.env[name];
    else process.env[name] = previousValue;
  }
});

describe("createRunMetadata", () => {
  it("describes a fake run without a model", () => {
    process.env.AGENTLAB_MODEL_PROVIDER = "fake";

    expect(createRunMetadata(
      { architecture: "single", agentConfigurationId: "structured" },
      { getCommit: () => "0aa5360" },
    )).toEqual({
      provider: "fake",
      architecture: "single",
      agentConfigurationId: "structured",
      agentConfigurationVersion: AGENT_CONFIGURATION_VERSIONS.structured,
      commit: "0aa5360",
    });
  });

  it.each([
    ["openai", "OPENAI_API_KEY", "OPENAI_MODEL", "test-openai-model"],
    ["gemini", "GEMINI_API_KEY", "GEMINI_MODEL", "test-gemini-model"],
  ] as const)("records the %s model name but never the API key", (provider, keyName, modelName, model) => {
    process.env.AGENTLAB_MODEL_PROVIDER = provider;
    process.env[keyName] = "private-test-key";
    process.env[modelName] = model;

    const run = createRunMetadata(
      { architecture: "handoff", agentConfigurationId: "handoff-default" },
      { getCommit: () => undefined },
    );

    expect(run).toEqual({
      provider,
      model,
      architecture: "handoff",
      agentConfigurationId: "handoff-default",
      agentConfigurationVersion: AGENT_CONFIGURATION_VERSIONS["handoff-default"],
    });
    expect(JSON.stringify(run)).not.toContain("private-test-key");
  });

  it("fails like the provider factory when the provider is not configured", () => {
    delete process.env.AGENTLAB_MODEL_PROVIDER;

    expect(() => createRunMetadata({ architecture: "single", agentConfigurationId: "baseline" }))
      .toThrow("AGENTLAB_MODEL_PROVIDER must be set to 'fake', 'openai', or 'gemini'.");
  });

  it("gives every configuration a positive integer version", () => {
    for (const version of Object.values(AGENT_CONFIGURATION_VERSIONS)) {
      expect(Number.isInteger(version) && version >= 1).toBe(true);
    }
  });
});

describe("getShortCommit", () => {
  let directoryWithoutGit: string;

  beforeEach(async () => {
    directoryWithoutGit = await mkdtemp(join(tmpdir(), "agentlab-no-git-"));
  });

  afterEach(async () => {
    await rm(directoryWithoutGit, { recursive: true, force: true });
  });

  it("returns undefined outside a Git repository or for a missing directory", () => {
    expect(getShortCommit({ cwd: directoryWithoutGit })).toBeUndefined();
    expect(getShortCommit({ cwd: join(directoryWithoutGit, "missing") })).toBeUndefined();
  });

  it("returns a short hexadecimal commit or undefined for the project directory", () => {
    const commit = getShortCommit();

    if (commit !== undefined) expect(commit).toMatch(/^[0-9a-f]{7,40}$/);
  });
});
