import { AgentFailure } from "./agent-failure";

/** The arbitrary signal reason never crosses the domain/event boundary. */
export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AgentFailure("cancelled");
}

export function abortableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  throwIfCancelled(signal);
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new AgentFailure("cancelled"));
    };
    const timer = setTimeout(() => { cleanup(); resolve(); }, delayMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
