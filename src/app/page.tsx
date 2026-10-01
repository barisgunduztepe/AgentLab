"use client";

import { useCallback, useEffect, useState } from "react";
import type { EvaluationResult, ExperimentEvent, ExperimentOutput, ExperimentStatus } from "@/experiments/types";
import type { ExperimentHistoryRecord, ExperimentHistorySummary } from "@/experiments/experiment-history";
import { SCENARIOS } from "@/experiments/scenarios";

type UiStatus = ExperimentStatus | "idle";
type ComparisonResult = {
  comparisonId: string;
  scenarioId: string;
  runs: { configurationId: "baseline" | "structured"; id: string; historySaved: boolean }[];
};

function statusLabel(status: UiStatus): string {
  switch (status) {
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      return "Idle";
  }
}

function eventLabel(event: ExperimentEvent): string {
  if (event.type === "agent.lifecycle") {
    const agentName = event.agentId === "analyst" ? "Analyst" : "Finalizer";
    return `${agentName} ${event.phase}`;
  }

  if (event.type === "handoff.completed") {
    return "Handoff completed — Analyst → Finalizer";
  }

  if (event.type === "handoff.failed") {
    return `Handoff failed — ${event.failureCode}`;
  }

  if ("agentId" in event && event.agentId) {
    return `${event.type} — ${event.agentId === "analyst" ? "Analyst" : "Finalizer"} · ${event.toolName}`;
  }

  return `${event.type}${"toolName" in event ? ` — ${event.toolName}` : ""}`;
}

function ExperimentEventList({ events, emptyMessage }: { events: ExperimentEvent[]; emptyMessage: string }) {
  if (events.length === 0) {
    return <p style={{ margin: 0, color: "#6b7585" }}>{emptyMessage}</p>;
  }

  return (
    <ol aria-live="polite" style={{ margin: 0, paddingLeft: 22 }}>
      {events.map((experimentEvent, index) => (
        <li key={`${experimentEvent.experimentId}-${index}`} style={{ marginBottom: 8 }}>
          <code>{eventLabel(experimentEvent)}</code>
          {experimentEvent.type === "agent.lifecycle" && experimentEvent.phase === "completed" && (
            <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {experimentEvent.output}
            </p>
          )}
          {experimentEvent.type === "agent.lifecycle" && experimentEvent.phase === "failed" && (
            <p style={{ margin: "4px 0 0", color: "#8f2424" }}>{experimentEvent.failureCode}</p>
          )}
          <span style={{ marginLeft: 10, color: "#6b7585" }}>
            {new Date(experimentEvent.occurredAt).toLocaleTimeString()}
          </span>
        </li>
      ))}
    </ol>
  );
}

export default function Home() {
  const [task, setTask] = useState("");
  const [selectedScenarioId, setSelectedScenarioId] = useState("");
  const [status, setStatus] = useState<UiStatus>("idle");
  const [events, setEvents] = useState<ExperimentEvent[]>([]);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [endedAt, setEndedAt] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [output, setOutput] = useState<ExperimentOutput | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [historySummaries, setHistorySummaries] = useState<ExperimentHistorySummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [historicalExperiment, setHistoricalExperiment] = useState<ExperimentHistoryRecord | null>(null);
  const [historicalLoading, setHistoricalLoading] = useState(false);
  const [historicalError, setHistoricalError] = useState<string | null>(null);
  const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const response = await fetch("/api/experiments/history");
      if (!response.ok) throw new Error();
      const body = await response.json() as { experiments: ExperimentHistorySummary[] };
      setHistorySummaries(body.experiments);
    } catch {
      setHistoryError("Experiment history is unavailable.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/experiments/history")
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return await response.json() as { experiments: ExperimentHistorySummary[] };
      })
      .then((body) => {
        if (active) setHistorySummaries(body.experiments);
      })
      .catch(() => {
        if (active) setHistoryError("Experiment history is unavailable.");
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedHistoryId) return;

    const controller = new AbortController();

    void fetch(`/api/experiments/history/${encodeURIComponent(selectedHistoryId)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return await response.json() as ExperimentHistoryRecord;
      })
      .then((record) => {
        if (!controller.signal.aborted) setHistoricalExperiment(record);
      })
      .catch(() => {
        if (!controller.signal.aborted) setHistoricalError("Experiment details are unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoricalLoading(false);
      });

    return () => controller.abort();
  }, [selectedHistoryId]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedTask = task.trim();

    if ((!selectedScenarioId && !submittedTask) || status === "running") {
      return;
    }

    setEvents([]);
    setStartedAt(null);
    setEndedAt(null);
    setDurationMs(null);
    setOutput(null);
    setErrorMessage(null);
    setEvaluation(null);
    setStatus("running");

    try {
      const response = await fetch("/api/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectedScenarioId ? { scenarioId: selectedScenarioId } : { task: submittedTask }),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message =
          typeof body === "object" &&
          body !== null &&
          "error" in body &&
          typeof body.error === "string"
            ? body.error
            : "The experiment could not be started.";
        setErrorMessage(message);
        setStatus("failed");
        return;
      }

      if (!response.body) {
        throw new Error("The event stream is unavailable.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let receivedFinalEvent = false;

      function handleEventBlock(block: string) {
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");

        if (!data) {
          return;
        }

        const experimentEvent = JSON.parse(data) as ExperimentEvent;
        setEvents((currentEvents) => [...currentEvents, experimentEvent]);

        switch (experimentEvent.type) {
          case "experiment.started":
            setStartedAt(experimentEvent.occurredAt);
            setStatus("running");
            break;
          case "agent.started":
            setStatus("running");
            break;
          case "agent.completed":
            setOutput(experimentEvent.output);
            break;
          case "experiment.completed":
            setEndedAt(experimentEvent.endedAt);
            setDurationMs(experimentEvent.durationMs);
            setStatus("completed");
            receivedFinalEvent = true;
            break;
          case "experiment.failed":
            setEndedAt(experimentEvent.endedAt);
            setDurationMs(experimentEvent.durationMs);
            setErrorMessage(experimentEvent.errorMessage);
            setStatus("failed");
            receivedFinalEvent = true;
            break;
          case "scenario.evaluated":
            setEvaluation(experimentEvent.evaluation);
            break;
        }
      }

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          buffer = buffer.replace(/\r\n/g, "\n");

          let separatorIndex = buffer.indexOf("\n\n");
          while (separatorIndex !== -1) {
            handleEventBlock(buffer.slice(0, separatorIndex));
            buffer = buffer.slice(separatorIndex + 2);
            separatorIndex = buffer.indexOf("\n\n");
          }
        }

        buffer += decoder.decode();
        if (buffer.trim()) {
          handleEventBlock(buffer);
        }
      } finally {
        reader.releaseLock();
        await refreshHistory();
      }

      if (!receivedFinalEvent) {
        setErrorMessage("The event stream ended before the experiment finished.");
        setStatus("failed");
      }
    } catch {
      setErrorMessage("The experiment could not be completed because the event stream failed.");
      setStatus("failed");
    }
  }

  async function handleComparison() {
    if (!selectedScenarioId || !comparableScenarioIds.has(selectedScenarioId) || isRunning || comparisonLoading) return;
    setComparisonLoading(true);
    setComparisonError(null);
    setComparisonResult(null);
    try {
      const response = await fetch("/api/experiments/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: selectedScenarioId }),
      });
      if (!response.ok) throw new Error();
      setComparisonResult(await response.json() as ComparisonResult);
      await refreshHistory();
    } catch {
      setComparisonError("The comparison could not be completed.");
    } finally {
      setComparisonLoading(false);
    }
  }

  const isRunning = status === "running";
  const selectedScenario = SCENARIOS.find((scenario) => scenario.id === selectedScenarioId);

  return (
    <main
      style={{
        maxWidth: 800,
        margin: "0 auto",
        padding: "40px 20px",
        color: "#172033",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <header style={{ marginBottom: 28 }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 32 }}>AgentLab</h1>
        <p style={{ margin: 0, color: "#536078" }}>
          Run an agent experiment and observe its events.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        style={{
          padding: 20,
          border: "1px solid #d7dce5",
          borderRadius: 8,
          background: "#fff",
        }}
      >
        <label htmlFor="experiment-mode" style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>
          Experiment type
        </label>
        <select
          id="experiment-mode"
          value={selectedScenarioId}
          onChange={(event) => {
            setSelectedScenarioId(event.target.value);
            setEvaluation(null);
            setComparisonResult(null);
            setComparisonError(null);
          }}
          disabled={isRunning}
          style={{
            display: "block",
            width: "100%",
            marginBottom: 16,
            padding: 10,
            border: "1px solid #aeb8c8",
            borderRadius: 6,
            font: "inherit",
          }}
        >
          <option value="">Custom task</option>
          {SCENARIOS.map((scenario) => (
            <option key={scenario.id} value={scenario.id}>{scenario.title}</option>
          ))}
        </select>
        {selectedScenario ? (
          <div aria-live="polite" style={{ padding: 12, border: "1px solid #d7dce5", borderRadius: 6 }}>
            <p style={{ margin: "0 0 6px", fontWeight: 600 }}>{selectedScenario.title}</p>
            <p style={{ margin: "0 0 8px", color: "#536078" }}>{selectedScenario.description}</p>
            <p style={{ margin: 0 }}>{selectedScenario.task}</p>
          </div>
        ) : (
          <>
            <label htmlFor="task" style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>
              Custom task
            </label>
            <textarea
              id="task"
              value={task}
              onChange={(event) => setTask(event.target.value)}
              placeholder="Describe what the agent should do..."
              rows={5}
              disabled={isRunning}
              style={{
                boxSizing: "border-box",
                width: "100%",
                padding: 12,
                border: "1px solid #aeb8c8",
                borderRadius: 6,
                font: "inherit",
                resize: "vertical",
              }}
            />
          </>
        )}
        {selectedScenarioId && comparableScenarioIds.has(selectedScenarioId) && (
          <div style={{ marginTop: 12 }}>
            <button type="button" onClick={() => void handleComparison()} disabled={isRunning || comparisonLoading}
              style={{ padding: "9px 14px", border: "1px solid #2457d6", borderRadius: 6, background: "#fff", color: "#2457d6", font: "inherit", cursor: "pointer" }}>
              {comparisonLoading ? "Running baseline and structured…" : "Run baseline / structured comparison"}
            </button>
            <p style={{ margin: "6px 0 0", color: "#536078" }}>Same scenario, provider, model, tools, and evaluator; no winner is selected.</p>
            {comparisonError && <p role="alert" style={{ color: "#8f2424" }}>{comparisonError}</p>}
            {comparisonResult && (
              <div aria-live="polite" style={{ marginTop: 10 }}>
                <p>Comparison {comparisonResult.comparisonId}</p>
                <ul>
                  {comparisonResult.runs.map((run) => (
                    <li key={run.id}>
                      {run.configurationId} — experiment {run.id} {run.historySaved ? "(saved)" : "(history not saved)"}{" "}
                      {run.historySaved && <button type="button" onClick={() => {
                        setSelectedHistoryId(run.id);
                        setHistoricalExperiment(null);
                        setHistoricalError(null);
                        setHistoricalLoading(true);
                      }}>Open history detail</button>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <button
          type="submit"
          disabled={isRunning || (!selectedScenarioId && task.trim().length === 0)}
          style={{
            marginTop: 12,
            padding: "10px 16px",
            border: 0,
            borderRadius: 6,
            background: isRunning || (!selectedScenarioId && task.trim().length === 0) ? "#9aa4b3" : "#2457d6",
            color: "#fff",
            font: "inherit",
            fontWeight: 600,
            cursor: isRunning || (!selectedScenarioId && task.trim().length === 0) ? "not-allowed" : "pointer",
          }}
        >
          {isRunning ? "Experiment running…" : "Start Experiment"}
        </button>
      </form>

      <section
        aria-live="polite"
        style={{
          marginTop: 20,
          padding: 20,
          border: "1px solid #d7dce5",
          borderRadius: 8,
          background: "#fff",
        }}
      >
        <h2 style={{ margin: "0 0 12px", fontSize: 20 }}>Experiment status</h2>
        <p role="status" style={{ margin: 0, fontWeight: 600 }}>
          {statusLabel(status)}
        </p>
        {(startedAt || endedAt || durationMs !== null) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px", color: "#536078" }}>
            {startedAt && <span>Started: {new Date(startedAt).toLocaleString()}</span>}
            {endedAt && <span>Finished: {new Date(endedAt).toLocaleString()}</span>}
            {durationMs !== null && <span>Duration: {durationMs} ms</span>}
          </div>
        )}
      </section>

      <section
        style={{
          marginTop: 20,
          padding: 20,
          border: "1px solid #d7dce5",
          borderRadius: 8,
          background: "#fff",
        }}
      >
        <h2 style={{ margin: "0 0 12px", fontSize: 20 }}>Observable events</h2>
        <ExperimentEventList events={events} emptyMessage="Events will appear here when an experiment starts." />
      </section>

      {evaluation && (
        <section
          aria-live="polite"
          style={{
            marginTop: 20,
            padding: 20,
            border: `1px solid ${evaluation.passed ? "#8cc9a1" : "#e5a4a4"}`,
            borderRadius: 8,
            background: evaluation.passed ? "#f1fbf4" : "#fff5f5",
          }}
        >
          <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>Scenario evaluation</h2>
          <p role="status" style={{ margin: "0 0 6px", fontWeight: 700 }}>
            {evaluation.passed ? "PASS" : "FAIL"}
          </p>
          <p style={{ margin: 0 }}>{evaluation.reason}</p>
        </section>
      )}

      {errorMessage && (
        <section
          role="alert"
          style={{
            marginTop: 20,
            padding: 20,
            border: "1px solid #e5a4a4",
            borderRadius: 8,
            background: "#fff5f5",
            color: "#8f2424",
          }}
        >
          <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>Experiment error</h2>
          <p style={{ margin: 0 }}>{errorMessage}</p>
        </section>
      )}

      <section
        style={{
          marginTop: 20,
          padding: 20,
          border: "1px solid #d7dce5",
          borderRadius: 8,
          background: "#fff",
        }}
      >
        <h2 style={{ margin: "0 0 12px", fontSize: 20 }}>Final result</h2>
        {output === null ? (
          <p style={{ margin: 0, color: "#6b7585" }}>The agent result will appear here when available.</p>
        ) : (
          <pre
            style={{
              margin: 0,
              padding: 12,
              borderRadius: 6,
              background: "#f4f6fa",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              fontFamily: "inherit",
            }}
          >
            {output.text}
          </pre>
        )}
      </section>

      <section
        style={{
          marginTop: 20,
          padding: 20,
          border: "1px solid #d7dce5",
          borderRadius: 8,
          background: "#fff",
        }}
      >
        <h2 style={{ margin: "0 0 12px", fontSize: 20 }}>Experiment history</h2>
        {historyLoading && historySummaries.length === 0 ? (
          <p>Loading history…</p>
        ) : historyError ? (
          <p role="alert" style={{ color: "#8f2424" }}>{historyError}</p>
        ) : historySummaries.length === 0 ? (
          <p style={{ color: "#6b7585" }}>No saved experiments yet.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {historySummaries.map((summary) => {
              const scenario = SCENARIOS.find((item) => item.id === summary.scenarioId);
              return (
                <li key={summary.id} style={{ marginBottom: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedHistoryId !== summary.id) {
                        setSelectedHistoryId(summary.id);
                        setHistoricalExperiment(null);
                        setHistoricalError(null);
                        setHistoricalLoading(true);
                      }
                    }}
                    aria-pressed={selectedHistoryId === summary.id}
                    style={{
                      width: "100%",
                      padding: 12,
                      textAlign: "left",
                      border: "1px solid #d7dce5",
                      borderRadius: 6,
                      background: selectedHistoryId === summary.id ? "#f1f5ff" : "#fff",
                      color: "inherit",
                      font: "inherit",
                      cursor: "pointer",
                    }}
                  >
                    <strong>{scenario ? scenario.title : summary.scenarioId ?? "Custom task"}</strong>
                    {summary.configurationId && <span> · {summary.configurationId}</span>}
                    <span> · {summary.status} · {new Date(summary.endedAt).toLocaleString()}</span>
                    {summary.evaluation && <span> · {summary.evaluation.passed ? "PASS" : "FAIL"}</span>}
                    <div style={{ marginTop: 4, color: "#536078", overflowWrap: "anywhere" }}>{summary.task}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {historyError && historySummaries.length > 0 && (
          <p role="alert" style={{ color: "#8f2424" }}>{historyError}</p>
        )}

        {selectedHistoryId && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #d7dce5" }}>
            {historicalLoading ? (
              <p>Loading experiment details…</p>
            ) : historicalError ? (
              <p role="alert" style={{ color: "#8f2424" }}>{historicalError}</p>
            ) : historicalExperiment ? (
              <>
                <h3 style={{ margin: "0 0 8px", fontSize: 18 }}>
                  {SCENARIOS.find((item) => item.id === historicalExperiment.scenarioId)?.title ??
                    historicalExperiment.scenarioId ?? "Custom task"}
                </h3>
                {historicalExperiment.configurationId && (
                  <p style={{ margin: "0 0 8px", color: "#536078" }}>
                    Comparison {historicalExperiment.comparisonId} · {historicalExperiment.configurationId}
                  </p>
                )}
                <p style={{ margin: "0 0 8px", whiteSpace: "pre-wrap" }}>{historicalExperiment.task}</p>
                <p style={{ margin: "0 0 8px", color: "#536078" }}>
                  {historicalExperiment.status} · {new Date(historicalExperiment.startedAt).toLocaleString()} – {new Date(historicalExperiment.endedAt).toLocaleString()} · {historicalExperiment.durationMs} ms
                </p>
                {historicalExperiment.output ? (
                  <pre style={{ margin: "8px 0", padding: 12, borderRadius: 6, background: "#f4f6fa", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "inherit" }}>
                    {historicalExperiment.output.text}
                  </pre>
                ) : historicalExperiment.errorMessage ? (
                  <p role="alert" style={{ color: "#8f2424" }}>{historicalExperiment.errorMessage}</p>
                ) : null}
                {historicalExperiment.evaluation && (
                  <p style={{ margin: "8px 0", fontWeight: 600 }}>
                    Scenario evaluation: {historicalExperiment.evaluation.passed ? "PASS" : "FAIL"} — {historicalExperiment.evaluation.reason}
                  </p>
                )}
                <h4 style={{ margin: "16px 0 8px" }}>Stored events</h4>
                <ExperimentEventList events={historicalExperiment.events} emptyMessage="No events were stored." />
              </>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}

const comparableScenarioIds = new Set([
  "direct-text",
  "calculator-once",
  "calculator-three-steps",
  "unknown-tool-failure",
]);
