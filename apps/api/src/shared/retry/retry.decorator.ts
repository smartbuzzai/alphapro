import { Logger } from '@nestjs/common';

const logger = new Logger('RetryDecorator');

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
  retryOn?: (error: Error) => boolean;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitter: true,
  retryOn: () => true,
};

/**
 * Method decorator: retries an async method with exponential backoff + jitter.
 *
 * @example
 * @Retry({ maxAttempts: 3, baseDelayMs: 500 })
 * async fetchExternalData() { ... }
 */
export function Retry(options: RetryOptions = {}) {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };

  return function (
    _target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      let lastError: Error;

      for (let attempt = 1; attempt <= opts.maxAttempts!; attempt++) {
        try {
          return await originalMethod.apply(this, args);
        } catch (error) {
          lastError = error as Error;

          const shouldRetry = opts.retryOn!(lastError);
          if (!shouldRetry || attempt === opts.maxAttempts) {
            throw lastError;
          }

          const delay = calculateDelay(attempt, opts);
          logger.warn(
            `[${propertyKey}] Attempt ${attempt}/${opts.maxAttempts} failed. ` +
              `Retrying in ${delay}ms... Error: ${lastError.message}`,
          );

          await sleep(delay);
        }
      }

      throw lastError!;
    };

    return descriptor;
  };
}

function calculateDelay(attempt: number, opts: RetryOptions): number {
  // Exponential backoff: baseDelay * 2^(attempt-1)
  const exponential = opts.baseDelayMs! * Math.pow(2, attempt - 1);
  const capped = Math.min(exponential, opts.maxDelayMs!);

  if (!opts.jitter) return capped;

  // Full jitter: random value between 0 and capped delay
  // Prevents thundering herd problem
  return Math.floor(Math.random() * capped);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Standalone retry utility for use outside decorators.
 *
 * @example
 * const result = await withRetry(() => fetchData(), { maxAttempts: 5 });
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error;

  for (let attempt = 1; attempt <= opts.maxAttempts!; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (!opts.retryOn!(lastError) || attempt === opts.maxAttempts) {
        throw lastError;
      }

      const delay = calculateDelay(attempt, opts);
      await sleep(delay);
    }
  }

  throw lastError!;
}
