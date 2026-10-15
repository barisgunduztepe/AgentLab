import { getOpenAICompatibleConfiguration } from "../src/agent/providers/openai-compatible-model-provider";
import { probeLocalEndpoint, runLocalSmoke } from "./local-smoke";

async function main() {
  const config = getOpenAICompatibleConfiguration();
  const probe = await probeLocalEndpoint(config);
  if (process.argv.includes("--check") || !probe.ready) {
    console.log(JSON.stringify({ provider: "openai-compatible", model: config.model, historyWritten: false, ...probe }));
    if (!probe.ready) process.exitCode = 1;
    return;
  }
  const report = await runLocalSmoke(config);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
main().catch(() => {
  console.error("Local smoke could not run. Check OPENAI_COMPATIBLE_BASE_URL, OPENAI_COMPATIBLE_MODEL and the installed local server. No history was written.");
  process.exitCode = 1;
});
