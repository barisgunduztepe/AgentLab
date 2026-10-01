import type { ModelProvider, ModelResponse, ModelTool } from "../model-provider";
import { RetryableProviderError } from "../retryable-provider-error";

const MAX_ATTEMPTS = 3;
const INITIAL_BACKOFF_CAP_MS = 500;
const BACKOFF_FACTOR = 2;
const MAX_BACKOFF_CAP_MS = 4000;

export interface RetryRuntime {
  sleep(delayMs: number): Promise<void>;
  random(): number;
}

const defaultRuntime: RetryRuntime = {
  sleep: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  random: () => Math.random(),
};

export class RetryingModelProvider implements ModelProvider {
  constructor(
    private readonly provider: ModelProvider,
    private readonly runtime: RetryRuntime = defaultRuntime,
  ) {}

  generateResponse(prompt: string, tools?: readonly ModelTool[]): Promise<ModelResponse> {
    return this.withRetry(() => this.provider.generateResponse(prompt, tools));
  }

  continueAfterToolCall(callId: string, output: string): Promise<ModelResponse> {
    return this.withRetry(() => this.provider.continueAfterToolCall(callId, output));
  }

  private async withRetry(operation: () => Promise<ModelResponse>): Promise<ModelResponse> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!(error instanceof RetryableProviderError) || attempt >= MAX_ATTEMPTS) {
          throw error;
        }

        const backoffCap = Math.min(
          MAX_BACKOFF_CAP_MS,
          INITIAL_BACKOFF_CAP_MS * BACKOFF_FACTOR ** (attempt - 1),
        );
        const randomValue = Math.max(0, Math.min(1, this.runtime.random()));
        await this.runtime.sleep(randomValue * backoffCap);
      }
    }
  }
}
