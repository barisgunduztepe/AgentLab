import type { ExperimentRunMetadata } from "./experiment-history";

export interface RunLabel {
  /** True only for runs known to come from the deterministic fake provider. */
  isFake: boolean;
  /** Short badge text for lists, e.g. "FAKE" or "openai". Empty when the run predates run metadata. */
  badge: string;
  /** Provider and model only, for views that cover several agent configurations (e.g. a comparison). */
  provider: string;
  /** Full description for detail views. */
  description: string;
}

/** Turns stored run metadata into display text. Records saved before v0.8.1 have no metadata. */
export function describeRunForDisplay(run: ExperimentRunMetadata | undefined): RunLabel {
  if (!run) {
    const description = "Provider not recorded (saved before run metadata existed)";
    return { isFake: false, badge: "", provider: description, description };
  }

  const isFake = run.provider === "fake";
  const provider = isFake ? "FAKE provider" : `${run.provider} · ${run.model}`;
  const parts = [
    provider,
    `${run.architecture} · ${run.agentConfigurationId} v${run.agentConfigurationVersion}`,
    ...(run.commit === undefined ? [] : [`commit ${run.commit}`]),
  ];

  return { isFake, badge: isFake ? "FAKE" : run.provider, provider, description: parts.join(" · ") };
}
