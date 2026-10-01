import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";

const envNames = ["AGENTLAB_MODEL_PROVIDER", "OPENAI_API_KEY", "OPENAI_MODEL", "GEMINI_API_KEY", "GEMINI_MODEL"] as const;
const previousEnv = new Map(envNames.map((name) => [name, process.env[name]]));

function post(body: unknown): Promise<Response> {
  return POST(new Request("http://localhost/api/experiments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

async function readEvents(response: Response): Promise<Record<string, unknown>[]> {
  const body = await response.text();
  return body
    .split("\n\n")
    .filter(Boolean)
    .map((block) => JSON.parse(block.split("\n").find((line) => line.startsWith("data: "))!.slice(6)) as Record<string, unknown>);
}

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

describe("POST /api/experiments fixed scenarios", () => {
  it("preserves the existing free-text task path", async () => {
    process.env.AGENTLAB_MODEL_PROVIDER = "fake";

    const response = await post({ task: "  Say hello.  " });
    const events = await readEvents(response);

    expect(response.status).toBe(200);
    expect(events).toContainEqual(expect.objectContaining({
      type: "agent.completed",
      output: { type: "text", text: "[Fake Model] Task received: Say hello." },
    }));
    expect(events.some((event) => event.type === "scenario.evaluated")).toBe(false);
  });

  it("runs the selected direct-text scenario with its Fake fixture", async () => {
    process.env.AGENTLAB_MODEL_PROVIDER = "fake";

    const response = await post({ scenarioId: "direct-text" });
    const events = await readEvents(response);

    expect(events.map((event) => event.type)).toEqual([
      "experiment.started",
      "agent.started",
      "agent.completed",
      "experiment.completed",
      "scenario.evaluated",
    ]);
    expect(events[2]).toMatchObject({
      type: "agent.completed",
      output: {
        type: "text",
        text: "Istanbul connects historic trade routes, empires, and cultures. Its monuments reflect Roman, Byzantine, and Ottoman periods. Its location between Europe and Asia shaped its long-standing importance.",
      },
    });
    expect(events[4]).toMatchObject({
      type: "scenario.evaluated",
      scenarioId: "direct-text",
      evaluation: { passed: true },
    });
    expect(events.filter((event) => event.type === "scenario.evaluated")).toHaveLength(1);
  });

  it("runs the single-calculator scenario with one tool lifecycle", async () => {
    process.env.AGENTLAB_MODEL_PROVIDER = "fake";

    const response = await post({ scenarioId: "calculator-once" });
    const events = await readEvents(response);

    expect(events.map((event) => event.type)).toEqual([
      "experiment.started",
      "agent.started",
      "tool.started",
      "tool.completed",
      "agent.completed",
      "experiment.completed",
      "scenario.evaluated",
    ]);
    expect(events[2]).toMatchObject({ type: "tool.started", toolName: "calculator" });
    expect(events[4]).toMatchObject({ type: "agent.completed", output: { text: "12 times 8 is 96." } });
    expect(JSON.stringify(events)).not.toContain("scenario-calculator-1");
    expect(JSON.stringify(events)).not.toContain("12 * 8");
    expect(events.at(-1)).toMatchObject({
      type: "scenario.evaluated",
      evaluation: { passed: true },
    });
    expect(events.filter((event) => event.type === "scenario.evaluated")).toHaveLength(1);
  });

  it("runs the three-tool scenario within the existing execution budget", async () => {
    process.env.AGENTLAB_MODEL_PROVIDER = "fake";

    const response = await post({ scenarioId: "calculator-three-steps" });
    const events = await readEvents(response);

    expect(events.filter((event) => event.type === "tool.started")).toHaveLength(3);
    expect(events.filter((event) => event.type === "tool.completed")).toHaveLength(3);
    expect(events.at(-2)).toMatchObject({ type: "experiment.completed" });
    expect(events.at(-1)).toMatchObject({
      type: "scenario.evaluated",
      scenarioId: "calculator-three-steps",
      evaluation: { passed: true },
    });
    expect(events.filter((event) => event.type === "scenario.evaluated")).toHaveLength(1);
    expect(events.some((event) => event.type === "agent.completed" &&
      (event.output as { text?: string }).text === "The three results are 5, 15, and 24.")).toBe(true);
    expect(JSON.stringify(events)).not.toContain("scenario-step-");
  });

  it("dispatches the handoff scenario through two Fake agents without scenario evaluation", async () => {
    process.env.AGENTLAB_MODEL_PROVIDER = "fake";

    const response = await post({ scenarioId: "analyst-finalizer-handoff" });
    const events = await readEvents(response);

    expect(events.map((event) => event.type)).toEqual([
      "experiment.started",
      "agent.started",
      "agent.lifecycle",
      "agent.lifecycle",
      "handoff.completed",
      "agent.lifecycle",
      "agent.lifecycle",
      "agent.completed",
      "experiment.completed",
    ]);
    expect(events[2]).toMatchObject({ type: "agent.lifecycle", agentId: "analyst", phase: "started" });
    expect(events[3]).toMatchObject({ type: "agent.lifecycle", agentId: "analyst", phase: "completed" });
    expect(events[3]).toMatchObject({
      output: "A thermostat measures room temperature, compares it with the set point, and activates heating or cooling to reduce the difference.",
    });
    expect(events[4]).toMatchObject({ type: "handoff.completed", fromAgentId: "analyst", toAgentId: "finalizer" });
    expect(events[5]).toMatchObject({ type: "agent.lifecycle", agentId: "finalizer", phase: "started" });
    expect(events[6]).toMatchObject({
      type: "agent.lifecycle",
      agentId: "finalizer",
      phase: "completed",
      output: "A thermostat keeps a room near its target by measuring the air temperature and comparing it with the set point. When the room is too cold or hot, it turns heating or cooling on, then switches it off as the target is reached.",
    });
    expect(events.find((event) => event.type === "agent.completed")).toMatchObject({
      output: {
        type: "text",
        text: "A thermostat keeps a room near its target by measuring the air temperature and comparing it with the set point. When the room is too cold or hot, it turns heating or cooling on, then switches it off as the target is reached.",
      },
    });
    expect(events.some((event) => event.type === "scenario.evaluated")).toBe(false);
  });

  it("fails safely for the unknown-tool scenario without executing a tool", async () => {
    process.env.AGENTLAB_MODEL_PROVIDER = "fake";

    const response = await post({ scenarioId: "unknown-tool-failure" });
    const events = await readEvents(response);

    expect(events.map((event) => event.type)).toEqual([
      "experiment.started",
      "agent.started",
      "experiment.failed",
      "scenario.evaluated",
    ]);
    expect(events.at(-2)).toMatchObject({
      type: "experiment.failed",
      errorMessage: "Agent görevi tamamlayamadı.",
    });
    expect(JSON.stringify(events)).not.toContain("weather_lookup");
    expect(JSON.stringify(events)).not.toContain("scenario-unknown-tool");
    expect(events.at(-1)).toMatchObject({
      type: "scenario.evaluated",
      scenarioId: "unknown-tool-failure",
      evaluation: {
        passed: true,
        reason: "Experiment failed safely before any tool execution.",
      },
    });
    expect(events.filter((event) => event.type === "scenario.evaluated")).toHaveLength(1);
  });

  it("keeps evaluation event data limited to the public envelope, scenario ID, and result", async () => {
    process.env.AGENTLAB_MODEL_PROVIDER = "fake";

    const response = await post({ scenarioId: "calculator-once" });
    const events = await readEvents(response);
    const evaluationEvent = events.find((event) => event.type === "scenario.evaluated")!;

    expect(Object.keys(evaluationEvent).sort()).toEqual([
      "evaluation",
      "experimentId",
      "occurredAt",
      "scenarioId",
      "type",
    ]);
    expect(JSON.stringify(evaluationEvent)).not.toContain("12 * 8");
    expect(JSON.stringify(evaluationEvent)).not.toContain("scenario-calculator-1");
    expect(JSON.stringify(evaluationEvent)).not.toContain("OPENAI_API_KEY");
  });

  it("rejects unknown scenario IDs without falling back", async () => {
    process.env.AGENTLAB_MODEL_PROVIDER = "fake";

    const response = await post({ scenarioId: "not-a-scenario" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Unknown scenario." });
  });

  it("rejects a payload that supplies both task and scenarioId", async () => {
    process.env.AGENTLAB_MODEL_PROVIDER = "fake";

    const response = await post({ task: "Say hello.", scenarioId: "direct-text" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Provide either task or scenarioId, not both.",
    });
  });
});
