"use client";

import { useState } from "react";
import type { ExperimentEvent, ExperimentOutput, ExperimentStatus } from "@/experiments/types";

type UiStatus = ExperimentStatus | "idle";

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

export default function Home() {
  const [task, setTask] = useState("");
  const [status, setStatus] = useState<UiStatus>("idle");
  const [events, setEvents] = useState<ExperimentEvent[]>([]);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [endedAt, setEndedAt] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [output, setOutput] = useState<ExperimentOutput | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedTask = task.trim();

    if (!submittedTask || status === "running") {
      return;
    }

    setEvents([]);
    setStartedAt(null);
    setEndedAt(null);
    setDurationMs(null);
    setOutput(null);
    setErrorMessage(null);
    setStatus("running");

    try {
      const response = await fetch("/api/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: submittedTask }),
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

  const isRunning = status === "running";

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
          Run a single agent experiment and observe its events.
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
        <label htmlFor="task" style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>
          Task
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
        <button
          type="submit"
          disabled={isRunning || task.trim().length === 0}
          style={{
            marginTop: 12,
            padding: "10px 16px",
            border: 0,
            borderRadius: 6,
            background: isRunning || task.trim().length === 0 ? "#9aa4b3" : "#2457d6",
            color: "#fff",
            font: "inherit",
            fontWeight: 600,
            cursor: isRunning || task.trim().length === 0 ? "not-allowed" : "pointer",
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
        {events.length === 0 ? (
          <p style={{ margin: 0, color: "#6b7585" }}>Events will appear here when an experiment starts.</p>
        ) : (
          <ol aria-live="polite" style={{ margin: 0, paddingLeft: 22 }}>
            {events.map((experimentEvent, index) => (
              <li key={`${experimentEvent.experimentId}-${index}`} style={{ marginBottom: 8 }}>
                <code>
                  {experimentEvent.type}
                  {"toolName" in experimentEvent && ` — ${experimentEvent.toolName}`}
                </code>
                <span style={{ marginLeft: 10, color: "#6b7585" }}>
                  {new Date(experimentEvent.occurredAt).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

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
            {output.type === "text"
              ? output.text
              : `Tool requested: ${output.toolName}\nStatus: ${output.status.replace("_", " ")}`}
          </pre>
        )}
      </section>
    </main>
  );
}
