/** One decoder and reader per POST. No reconnect or automatic POST retry. */
export async function readEventStream<T>(response: Response, signal: AbortSignal, onEvent: (event: T) => void): Promise<void> {
  if (!response.body) throw new Error("The event stream is unavailable.");
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let buffer = ""; let ended = false;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  const dispatch = (block: string) => {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (data && !signal.aborted) onEvent(JSON.parse(data) as T);
  };
  try {
    if (signal.aborted) { cancel(); return; }
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) { ended = true; break; }
      buffer += decoder.decode(value, { stream: true });
      // Normalize only complete CRLF pairs; a CR may end a chunk.
      buffer = buffer.replace(/\r\n/g, "\n");
      let separator: number;
      while ((separator = buffer.indexOf("\n\n")) !== -1) {
        dispatch(buffer.slice(0, separator)); buffer = buffer.slice(separator + 2);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim() && !signal.aborted) dispatch(buffer);
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!ended) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
