/** Transport only. Domain finalization continues after a client disconnect. */
export function streamResponse<T>(request: Request, execute: (signal: AbortSignal, send: (event: T) => void) => Promise<unknown>, vary = false): Response {
  const encoder = new TextEncoder(); const controller = new AbortController();
  let closed = false;
  const disconnect = () => { closed = true; controller.abort(); };
  request.signal.addEventListener("abort", disconnect, { once: true });
  if (request.signal.aborted) disconnect();
  const stream = new ReadableStream<Uint8Array>({
    start(output) {
      const send = (event: T) => {
        if (closed) return;
        try { output.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { disconnect(); }
      };
      void execute(controller.signal, send).catch(() => {
        if (!closed) { output.error(new Error("Experiment stream failed.")); closed = true; }
      }).finally(() => {
        request.signal.removeEventListener("abort", disconnect);
        if (!closed) { closed = true; output.close(); }
      });
    },
    cancel: disconnect,
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", ...(vary ? { Vary: "Accept" } : {}) } });
}
