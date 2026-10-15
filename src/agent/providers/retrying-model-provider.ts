import { abortableDelay, throwIfCancelled } from "../cancellation";
import type { ModelProvider, ModelResponse, CompleteRequest } from "../model-provider";
import { RetryableProviderError } from "../retryable-provider-error";

const MAX_ATTEMPTS = 3;
const INITIAL_BACKOFF_CAP_MS = 500;
const BACKOFF_FACTOR = 2;
const MAX_BACKOFF_CAP_MS = 4000;

export interface RetryRuntime {
  sleep(delayMs: number, signal?: AbortSignal): Promise<void>;
  random(): number;
}

const defaultRuntime: RetryRuntime = {
  sleep: abortableDelay,
  random: () => Math.random(),
};

export class RetryingModelProvider implements ModelProvider {
  constructor(
    private readonly provider: ModelProvider,
    private readonly runtime: RetryRuntime = defaultRuntime,
  ) {}

  complete(request: CompleteRequest): Promise<ModelResponse> {
    return this.withRetry(() => this.provider.complete(request), request.signal);
  }

  private async withRetry(operation: () => Promise<ModelResponse>, signal?: AbortSignal): Promise<ModelResponse> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        throwIfCancelled(signal);
        const result = await operation();
        throwIfCancelled(signal);
        return result;
      } catch (error) {
        throwIfCancelled(signal);
        if (!(error instanceof RetryableProviderError) || attempt >= MAX_ATTEMPTS) {
          throw error;
        }

        const backoffCap = Math.min(
          MAX_BACKOFF_CAP_MS,
          INITIAL_BACKOFF_CAP_MS * BACKOFF_FACTOR ** (attempt - 1),
        );
        const randomValue = Math.max(0, Math.min(1, this.runtime.random()));
        await this.runtime.sleep(randomValue * backoffCap, signal);
      }
    }
  }
}
