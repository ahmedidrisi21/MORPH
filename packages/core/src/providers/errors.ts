/** Base class for every error a provider throws. `resolve()` never lets these escape. */
export class ProviderError extends Error {
  override name = "ProviderError";
  readonly provider: string;
  readonly requestId: string | undefined;
  constructor(
    provider: string,
    message: string,
    opts: { cause?: unknown; requestId?: string } = {},
  ) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.provider = provider;
    this.requestId = opts.requestId;
  }
}

/** The provider answered, but the answer is malformed (missing keys, bad probabilities). */
export class ProviderResponseError extends ProviderError {
  override name = "ProviderResponseError";
}

/** The provider (or the whole chain) ran out of time. */
export class ProviderTimeoutError extends ProviderError {
  override name = "ProviderTimeoutError";
}

/** Rate limited upstream. */
export class ProviderRateLimitError extends ProviderError {
  override name = "ProviderRateLimitError";
  readonly retryAfterMs: number | undefined;
  constructor(
    provider: string,
    message: string,
    opts: { cause?: unknown; requestId?: string; retryAfterMs?: number } = {},
  ) {
    super(provider, message, opts);
    this.retryAfterMs = opts.retryAfterMs;
  }
}

/** ReplayProvider in `replay` mode found no fixture for a spec. */
export class ReplayMissError extends ProviderError {
  override name = "ReplayMissError";
  constructor(readonly keys: string[]) {
    super("replay", `No replay fixture for ${keys.length} spec(s).`);
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
