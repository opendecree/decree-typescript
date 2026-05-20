import { Metadata, type ServiceError, status } from "@grpc/grpc-js";
import { describe, expect, it, vi } from "vitest";
import {
	READ_RETRYABLE_CODES,
	WRITE_IDEMPOTENT_RETRYABLE_CODES,
	WRITE_RETRYABLE_CODES,
	withRetry,
} from "../src/retry.js";

function makeServiceError(code: number, details: string): ServiceError {
	const err = new Error(details) as ServiceError;
	err.code = code;
	err.details = details;
	err.metadata = new Metadata();
	return err;
}

describe("withRetry", () => {
	it("returns result on first success", async () => {
		const result = await withRetry({}, async () => "ok");
		expect(result).toBe("ok");
	});

	it("calls function once when config is false", async () => {
		const fn = vi.fn().mockResolvedValue("ok");
		await withRetry(false, fn);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("calls function once when config is undefined", async () => {
		const fn = vi.fn().mockResolvedValue("ok");
		await withRetry(undefined, fn);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("retries on UNAVAILABLE", async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(makeServiceError(status.UNAVAILABLE, "unavailable"))
			.mockResolvedValue("ok");

		const result = await withRetry({ maxAttempts: 3, initialBackoff: 1, maxBackoff: 10 }, fn);
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("retries on DEADLINE_EXCEEDED", async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(makeServiceError(status.DEADLINE_EXCEEDED, "timeout"))
			.mockResolvedValue("ok");

		const result = await withRetry({ maxAttempts: 3, initialBackoff: 1, maxBackoff: 10 }, fn);
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("does not retry on non-retryable codes", async () => {
		const fn = vi.fn().mockRejectedValue(makeServiceError(status.NOT_FOUND, "not found"));

		await expect(withRetry({ maxAttempts: 3, initialBackoff: 1 }, fn)).rejects.toThrow("not found");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("throws after exhausting all attempts", async () => {
		const fn = vi.fn().mockRejectedValue(makeServiceError(status.UNAVAILABLE, "down"));

		await expect(
			withRetry({ maxAttempts: 3, initialBackoff: 1, maxBackoff: 5 }, fn),
		).rejects.toThrow("down");
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it("does not retry non-ServiceError exceptions", async () => {
		const fn = vi.fn().mockRejectedValue(new Error("generic"));

		await expect(withRetry({ maxAttempts: 3, initialBackoff: 1 }, fn)).rejects.toThrow("generic");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("respects custom retryable codes", async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(makeServiceError(status.INTERNAL, "internal"))
			.mockResolvedValue("ok");

		const result = await withRetry(
			{ maxAttempts: 3, initialBackoff: 1, retryableCodes: [status.INTERNAL] },
			fn,
		);
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("respects maxAttempts of 1 (no retries)", async () => {
		const fn = vi.fn().mockRejectedValue(makeServiceError(status.UNAVAILABLE, "down"));

		await expect(withRetry({ maxAttempts: 1, initialBackoff: 1 }, fn)).rejects.toThrow("down");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("default config retries on RESOURCE_EXHAUSTED (read default)", async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(makeServiceError(status.RESOURCE_EXHAUSTED, "quota"))
			.mockResolvedValue("ok");

		const result = await withRetry({ maxAttempts: 3, initialBackoff: 1 }, fn);
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(2);
	});
});

describe("retry code sets", () => {
	it("READ_RETRYABLE_CODES includes UNAVAILABLE, DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED", () => {
		expect(READ_RETRYABLE_CODES).toContain(status.UNAVAILABLE);
		expect(READ_RETRYABLE_CODES).toContain(status.DEADLINE_EXCEEDED);
		expect(READ_RETRYABLE_CODES).toContain(status.RESOURCE_EXHAUSTED);
	});

	it("WRITE_RETRYABLE_CODES includes only UNAVAILABLE", () => {
		expect(WRITE_RETRYABLE_CODES).toContain(status.UNAVAILABLE);
		expect(WRITE_RETRYABLE_CODES).not.toContain(status.DEADLINE_EXCEEDED);
		expect(WRITE_RETRYABLE_CODES).not.toContain(status.RESOURCE_EXHAUSTED);
	});

	it("WRITE_IDEMPOTENT_RETRYABLE_CODES includes UNAVAILABLE and DEADLINE_EXCEEDED", () => {
		expect(WRITE_IDEMPOTENT_RETRYABLE_CODES).toContain(status.UNAVAILABLE);
		expect(WRITE_IDEMPOTENT_RETRYABLE_CODES).toContain(status.DEADLINE_EXCEEDED);
		expect(WRITE_IDEMPOTENT_RETRYABLE_CODES).not.toContain(status.RESOURCE_EXHAUSTED);
	});

	it("withRetry uses WRITE_RETRYABLE_CODES: does not retry DEADLINE_EXCEEDED", async () => {
		const fn = vi
			.fn()
			.mockRejectedValue(makeServiceError(status.DEADLINE_EXCEEDED, "timeout"));

		await expect(
			withRetry({ maxAttempts: 3, initialBackoff: 1, retryableCodes: [...WRITE_RETRYABLE_CODES] }, fn),
		).rejects.toThrow("timeout");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("withRetry uses WRITE_IDEMPOTENT_RETRYABLE_CODES: retries DEADLINE_EXCEEDED", async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(makeServiceError(status.DEADLINE_EXCEEDED, "timeout"))
			.mockResolvedValue("ok");

		const result = await withRetry(
			{ maxAttempts: 3, initialBackoff: 1, retryableCodes: [...WRITE_IDEMPOTENT_RETRYABLE_CODES] },
			fn,
		);
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(2);
	});
});
