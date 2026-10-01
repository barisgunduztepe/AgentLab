import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";

const envNames = ["AGENTLAB_MODEL_PROVIDER", "OPENAI_API_KEY", "OPENAI_MODEL", "GEMINI_API_KEY", "GEMINI_MODEL"] as const;
const previousEnv = new Map(envNames.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of envNames) {
    const previousValue = previousEnv.get(name);
    if (previousValue === undefined) delete process.env[name];
    else process.env[name] = previousValue;
  }
});

describe("POST /api/experiments provider configuration", () => {
  it.each([undefined, "unknown"])("rejects missing or invalid provider selection: %s", async (provider) => {
    if (provider === undefined) delete process.env.AGENTLAB_MODEL_PROVIDER;
    else process.env.AGENTLAB_MODEL_PROVIDER = provider;
    process.env.OPENAI_API_KEY = "secret-test-key";
    process.env.OPENAI_MODEL = "test-model";

    const response = await POST(new Request("http://localhost/api/experiments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "Say hello." }),
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Experiment provider is not configured." });
  });

  it("does not disclose missing OpenAI configuration details", async () => {
    process.env.AGENTLAB_MODEL_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "secret-test-key";
    delete process.env.OPENAI_MODEL;

    const response = await POST(new Request("http://localhost/api/experiments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "Say hello." }),
    }));
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain("Experiment provider is not configured.");
    expect(body).not.toContain("secret-test-key");
    expect(body).not.toContain("OPENAI_MODEL");
  });

  it("does not disclose missing Gemini configuration details or key", async () => {
    process.env.AGENTLAB_MODEL_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "secret-gemini-test-key";
    delete process.env.GEMINI_MODEL;

    const response = await POST(new Request("http://localhost/api/experiments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "Say hello." }),
    }));
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain("Experiment provider is not configured.");
    expect(body).not.toContain("secret-gemini-test-key");
    expect(body).not.toContain("GEMINI_MODEL");
  });
});
