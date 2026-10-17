import { getOpenAICompatibleConfiguration } from "../src/agent/providers/openai-compatible-model-provider";
import { parseSmokeArguments, probeLocalEndpoint, runLocalSmoke } from "./local-smoke";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LocalResponseRecording } from "./local-response-recording";
import { recordingProvenance } from "./local-response-recording";

async function main() {
  const options = parseSmokeArguments(process.argv.slice(2));
  const config = getOpenAICompatibleConfiguration();
  const probe = await probeLocalEndpoint(config);
  if (options.check || !probe.ready) {
    console.log(JSON.stringify({ provider: "openai-compatible", model: config.model, historyWritten: false, ...probe }));
    if (!probe.ready) process.exitCode = 1;
    return;
  }
  const responses: LocalResponseRecording[] = [];
  const recording = options.record;
  const report = await runLocalSmoke(config, fetch, { scenarioId: options.scenarioId, configurationId: options.configurationId,
    ...(recording ? { record: (response: LocalResponseRecording) => responses.push(response) } : {}) });
  if (recording && responses.length) {
    const directory = join(process.cwd(), "src/agent/providers/fixtures/local");
    await mkdir(directory, { recursive: true });
    const capturedAt = new Date().toISOString();
    const filename = `${config.model.replace(/[^a-zA-Z0-9_-]/g, "-")}-${capturedAt.replace(/[:.]/g, "-")}.json`;
    await writeFile(join(directory, filename), JSON.stringify({ ...recordingProvenance(config.model, capturedAt, options.scenarioId, options.configurationId),
      responses }, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    console.log(JSON.stringify({ recording: filename, responseCount: responses.length }));
  }
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
main().catch(() => {
  console.error("Local smoke could not run. Check OPENAI_COMPATIBLE_BASE_URL, OPENAI_COMPATIBLE_MODEL and the installed local server. No history was written.");
  process.exitCode = 1;
});
