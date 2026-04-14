import { Metadata, type ServiceError, status } from "@grpc/grpc-js";
import { describe, expect, it, vi } from "vitest";
import { withRetry } from "../src/retry.js";

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
});
