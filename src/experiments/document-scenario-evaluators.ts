import type { Experiment, ExperimentEvent, EvaluationResult } from "./types";

type ExpectedResult = Record<string, string>;
const fail = (category: string): EvaluationResult => ({ passed: false, reason: `Document scenario failed: ${category}.` });

function parseResult(text: string, keys: string[]): ExpectedResult | undefined {
  if (!text.trim() || new TextEncoder().encode(text).byteLength > 8192) return;
  const lines = text.trimEnd().split(/\r?\n/);
  let fence: string | undefined;
  let candidate: string | undefined;
  let candidates = 0;
  for (const line of lines) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined;
    }
    if (/^RESULT\b/.test(line)) {
      candidates += 1;
      if (!fence && line.startsWith("RESULT ")) candidate = line;
    }
  }
  if (candidates !== 1 || !candidate || lines.at(-1) !== candidate) return;
  const fields: ExpectedResult = {};
  for (const field of candidate.slice(7).split(";")) {
    const separator = field.indexOf("=");
    if (separator < 1) return;
    const key = field.slice(0, separator).trim();
    const value = field.slice(separator + 1).trim();
    if (!keys.includes(key) || Object.hasOwn(fields, key) || !value) return;
    fields[key] = value;
  }
  if (Object.keys(fields).length !== keys.length) return;
  const sources = fields.sources.split(",").map((id) => id.trim());
  if (sources.some((id) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) || new Set(sources).size !== sources.length) return;
  fields.sources = sources.sort().join(",");
  return fields;
}

function evaluate(experiment: Experiment, events: readonly ExperimentEvent[], expected: ExpectedResult,
  acceptsTools: (names: string[]) => boolean): EvaluationResult {
  if (experiment.status !== "completed" || experiment.output?.type !== "text") return fail("completion");
  let pending: string | undefined;
  let requested = false;
  const names: string[] = [];
  for (const event of events) {
    if (event.experimentId !== experiment.id || event.type === "agent.lifecycle" || ("agentId" in event && event.agentId !== undefined) ||
      event.type.startsWith("handoff.") || event.type === "model.skipped" || event.type === "tool.failed") return fail("tool sequence");
    if (event.type === "model.requested") requested = true;
    if (event.type === "tool.started") {
      if (pending !== undefined) return fail("tool sequence");
      pending = event.toolName;
    }
    if (event.type === "tool.completed") {
      if (pending !== event.toolName) return fail("tool sequence");
      names.push(event.toolName);
      pending = undefined;
    }
  }
  if (!requested || pending !== undefined || !acceptsTools(names)) return fail("tool sequence");
  const parsed = parseResult(experiment.output.text, Object.keys(expected));
  if (!parsed) return fail("result format");
  for (const [key, value] of Object.entries(expected)) {
    const target = key === "sources" ? value.split(",").sort().join(",") : value;
    if (parsed[key] !== target) return fail("result value");
  }
  return { passed: true, reason: "Document result and observed tool sequence matched." };
}

export function evaluateDocumentChain(experiment: Experiment, events: readonly ExperimentEvent[]): EvaluationResult {
  return evaluate(experiment, events, { destination: "dock-r2", sources: "route-amber,sheet-k7" },
    (names) => names.length >= 2 && names.length <= 3 && names.every((name) => name === "document_search"));
}
export function evaluateDocumentConflict(experiment: Experiment, events: readonly ExperimentEvent[]): EvaluationResult {
  return evaluate(experiment, events, { days: "14", rejected_days: "7", sources: "policy-saffron-current,policy-saffron-old" },
    (names) => names.length >= 1 && names.length <= 3 && names.every((name) => name === "document_search"));
}
export function evaluateDocumentCalculation(experiment: Experiment, events: readonly ExperimentEvent[]): EvaluationResult {
  return evaluate(experiment, events, { total_credits: "161", sources: "order-cobalt,rate-m4" },
    (names) => names.join(",") === "document_search,document_search,calculator");
}
