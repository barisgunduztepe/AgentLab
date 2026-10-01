import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeModelProvider } from "../../../../agent/providers/fake-model-provider";
import type { ModelResponse, ModelTool } from "../../../../agent/model-provider";
import { STRUCTURED_AGENT_INSTRUCTION } from "../../../../agent/single-agent";
import { ExperimentHistoryStore } from "../../../../experiments/experiment-history";
import { createComparisonPostHandler } from "./comparison-post-handler";

const previousProvider = process.env.AGENTLAB_MODEL_PROVIDER;
let temporaryDirectory: string;
let history: ExperimentHistoryStore;

class CapturingFakeProvider extends FakeModelProvider {
  readonly prompts: string[] = [];
  readonly toolDefinitions: (readonly ModelTool[])[] = [];

  override generateResponse(prompt: string, tools: readonly ModelTool[] = []): Promise<ModelResponse> {
    this.prompts.push(prompt);
    this.toolDefinitions.push(tools);
    return super.generateResponse(prompt);
  }
}

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "agentlab-comparison-"));
  history = new ExperimentHistoryStore(join(temporaryDirectory, "experiments.json"));
  process.env.AGENTLAB_MODEL_PROVIDER = "fake";
});

afterEach(async () => {
  if (previousProvider === undefined) delete process.env.AGENTLAB_MODEL_PROVIDER;
  else process.env.AGENTLAB_MODEL_PROVIDER = previousProvider;
  await rm(temporaryDirectory, { recursive: true, force: true });
});

function request(scenarioId: string): Request {
  return new Request("http://localhost/api/experiments/compare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenarioId }),
  });
}

describe("POST /api/experiments/compare", () => {
  it("runs baseline then structured with the same task, saves separate related records, and evaluates independently", async () => {
    const providers: CapturingFakeProvider[] = [];
    const createProviders = vi.fn((fixtures) => {
      const baseline = new CapturingFakeProvider(fixtures?.baseline);
      const structured = new CapturingFakeProvider(fixtures?.structured);
      providers.push(baseline, structured);
      return [baseline, structured] as [FakeModelProvider, FakeModelProvider];
    });
    const handlePost = createComparisonPostHandler(history, {
      createProviders,
      createComparisonId: () => "comparison-fixed",
    });

    const response = await handlePost(request("direct-text"));
    const body = await response.json();
    const saved = await history.readAll();

    expect(response.status).toBe(200);
    expect(providers[0].prompts).toEqual([
      "Write three short sentences about why Istanbul is historically important.",
    ]);
    expect(providers[1].prompts).toEqual([
      `Write three short sentences about why Istanbul is historically important.\n\n${STRUCTURED_AGENT_INSTRUCTION}`,
    ]);
    expect(providers).toHaveLength(2);
    expect(providers[0].toolDefinitions[0]).toBe(providers[1].toolDefinitions[0]);
    expect(createProviders).toHaveBeenCalledOnce();
    expect(body).toMatchObject({
      comparisonId: "comparison-fixed",
      scenarioId: "direct-text",
      runs: [
        { configurationId: "baseline", status: "completed", evaluation: { passed: true } },
        { configurationId: "structured", status: "completed", evaluation: { passed: true } },
      ],
    });
    expect(body.runs[0].id).not.toBe(body.runs[1].id);
    expect(saved).toHaveLength(2);
    expect(saved.map(({ comparisonId, configurationId, scenarioId, task, schemaVersion }) => ({
      comparisonId, configurationId, scenarioId, task, schemaVersion,
    }))).toEqual([
      { comparisonId: "comparison-fixed", configurationId: "baseline", scenarioId: "direct-text", task: "Write three short sentences about why Istanbul is historically important.", schemaVersion: 2 },
      { comparisonId: "comparison-fixed", configurationId: "structured", scenarioId: "direct-text", task: "Write three short sentences about why Istanbul is historically important.", schemaVersion: 2 },
    ]);
  });

  it("executes structured after a baseline failure and rejects scenarios outside the fixed comparable set", async () => {
    const handlePost = createComparisonPostHandler(history, {
      createProviders: () => [
        new FakeModelProvider([{ type: "tool_call", callId: "unknown", toolName: "not_registered", input: "secret" }]),
        new FakeModelProvider([{ type: "text", text: "Structured response." }]),
      ],
      createComparisonId: () => "comparison-failure",
    });
    const response = await handlePost(request("direct-text"));
    const body = await response.json();

    expect(body.runs.map((run: { configurationId: string; status: string }) => [run.configurationId, run.status]))
      .toEqual([["baseline", "failed"], ["structured", "completed"]]);
    expect(body.runs.map((run: { evaluation: { passed: boolean } }) => run.evaluation.passed))
      .toEqual([false, true]);
    expect(await history.readAll()).toHaveLength(2);

    const rejected = await handlePost(request("analyst-finalizer-handoff"));
    expect(rejected.status).toBe(400);
  });

  it("does not claim a complete persisted pair when one history save fails", async () => {
    const append = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("private filesystem path"));
    const handlePost = createComparisonPostHandler({ append } as unknown as ExperimentHistoryStore, {
      createProviders: () => [
        new FakeModelProvider([{ type: "text", text: "Baseline response." }]),
        new FakeModelProvider([{ type: "text", text: "Structured response." }]),
      ],
    });

    const response = await handlePost(request("direct-text"));
    const rawBody = await response.text();
    const body = JSON.parse(rawBody);
    expect(body.runs.map((run: { historySaved: boolean }) => run.historySaved)).toEqual([true, false]);
    expect(response.status).toBe(200);
    expect(rawBody).not.toContain("private filesystem path");
  });
});
