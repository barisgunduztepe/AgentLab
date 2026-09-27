import { FakeModelProvider } from "@/agent/providers/fake-model-provider";
import { SingleAgent } from "@/agent/single-agent";
import { CalculatorTool } from "@/tools/calculator-tool";
import { runExperiment } from "@/experiments/run-experiment";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("task" in body) ||
    typeof body.task !== "string" ||
    body.task.trim().length === 0
  ) {
    return Response.json(
      { error: "A non-empty task string is required." },
      { status: 400 },
    );
  }

  const task = body.task.trim();
  const encoder = new TextEncoder();
  let streamCancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const calculatorTool = new CalculatorTool();
        const agent = new SingleAgent(new FakeModelProvider(), [calculatorTool]);

        await runExperiment(task, agent, (event) => {
          if (streamCancelled) {
            return;
          }

          const data = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(data));
        });
      } finally {
        if (!streamCancelled) {
          controller.close();
        }
      }
    },
    cancel() {
      streamCancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });
}
