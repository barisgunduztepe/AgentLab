/** Safe marker used by real providers for failures the retry layer may repeat. */
export class RetryableProviderError extends Error {
  constructor() {
    super("Provider request failed.");
    this.name = "RetryableProviderError";
  }
}
