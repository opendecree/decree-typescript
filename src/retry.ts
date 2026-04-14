/**
 * Retry logic with exponential backoff and jitter.
 *
 * Retries on UNAVAILABLE and DEADLINE_EXCEEDED by default.
 */

import { type ServiceError, status } from "@grpc/grpc-js";
import type { RetryConfig } from "./types.js";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INITIAL_BACKOFF = 100; // ms
const DEFAULT_MAX_BACKOFF = 5000; // ms
const DEFAULT_MULTIPLIER = 2;
const DEFAULT_RETRYABLE_CODES: readonly number[] = [status.UNAVAILABLE, status.DEADLINE_EXCEEDED];

function isServiceError(err: unknown): err is ServiceError {
	return err instanceof Error && typeof (err as ServiceError).code === "number";
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an async function with retry on transient gRPC errors.
 *
 * Uses exponential backoff with jitter (0.5x to 1.5x multiplier on backoff).
 * If config is false or undefined, the function is called once without retry.
 */
export async function withRetry<T>(
	config: RetryConfig | false | undefined,
	fn: () => Promise<T>,
): Promise<T> {
	if (config === false || config === undefined) {
		return fn();
	}

	const maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
	const initialBackoff = config.initialBackoff ?? DEFAULT_INITIAL_BACKOFF;
	const maxBackoff = config.maxBackoff ?? DEFAULT_MAX_BACKOFF;
	const multiplier = config.multiplier ?? DEFAULT_MULTIPLIER;
	const retryableCodes = config.retryableCodes ?? DEFAULT_RETRYABLE_CODES;

	let lastErr: Error | undefined;
	let backoff = initialBackoff;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (err) {
			if (!isServiceError(err)) {
				throw err;
			}
			if (!retryableCodes.includes(err.code) || attempt === maxAttempts - 1) {
				throw err;
			}
			lastErr = err;
			const jitter = 0.5 + Math.random();
			await sleep(backoff * jitter);
			backoff = Math.min(backoff * multiplier, maxBackoff);
		}
	}

	// Should not reach here, but satisfy TypeScript.
	throw lastErr;
}
