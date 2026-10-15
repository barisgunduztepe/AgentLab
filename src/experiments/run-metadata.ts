import { ARCHITECTURE_DEFINITIONS } from "../agent/architecture-definitions";
import { execFileSync } from "node:child_process";
import { describeConfiguredProvider } from "../agent/create-model-provider";
import type {
  ExperimentArchitecture,
  ExperimentRunMetadata,
  RunAgentConfigurationId,
} from "./experiment-history";

/**
 * Version of each agent configuration's instructions. Bump a number whenever the prompt text or
 * handoff assignment templates for that configuration change, so history shows which wording ran.
 */
export const AGENT_CONFIGURATION_VERSIONS = Object.fromEntries(Object.entries(ARCHITECTURE_DEFINITIONS).map(([id, entry]) => [id, entry.version])) as Record<RunAgentConfigurationId, number>;

/**
 * Short Git commit of the code that is running, or undefined when it cannot be determined.
 * It does not reflect uncommitted changes, so a development run may differ from the commit.
 */
export function getShortCommit(options: { cwd?: string } = {}): string | undefined {
  try {
    const output = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      cwd: options.cwd ?? process.cwd(),
      encoding: "utf8",
      timeout: 2000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^[0-9a-f]{7,40}$/.test(output) ? output : undefined;
  } catch {
    return undefined;
  }
}

export function createRunMetadata(
  agent: { architecture: ExperimentArchitecture; agentConfigurationId: RunAgentConfigurationId },
  dependencies: {
    describeProvider?: typeof describeConfiguredProvider;
    getCommit?: () => string | undefined;
  } = {},
): ExperimentRunMetadata {
  const provider = (dependencies.describeProvider ?? describeConfiguredProvider)();
  const commit = (dependencies.getCommit ?? getShortCommit)();

  return {
    provider: provider.provider,
    ...(provider.model === undefined ? {} : { model: provider.model }),
    architecture: agent.architecture,
    agentConfigurationId: agent.agentConfigurationId,
    agentConfigurationVersion: AGENT_CONFIGURATION_VERSIONS[agent.agentConfigurationId],
    ...(commit === undefined ? {} : { commit }),
  };
}
