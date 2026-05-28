import { Metadata, type ServiceError, status } from "@grpc/grpc-js";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { ConfigClient } from "../src/client.js";
import {
	ChecksumMismatchError,
	DeadlineExceededError,
	DecreeError,
	IncompatibleServerError,
	NotFoundError,
	UnavailableError,
} from "../src/errors.js";

// Mock the generated gRPC client constructors.
// We need to intercept the constructor calls and replace them with stubs.
vi.mock("../src/generated/centralconfig/v1/config_service.js", () => {
	const MockConfigServiceClient = vi.fn();
	return { ConfigServiceClient: MockConfigServiceClient };
});

vi.mock("../src/generated/centralconfig/v1/server_service.js", () => {
	const MockServerServiceClient = vi.fn();
	return { ServerServiceClient: MockServerServiceClient };
});

function makeServiceError(code: number, details: string): ServiceError {
	const err = new Error(details) as ServiceError;
	err.code = code;
	err.details = details;
	err.metadata = new Metadata();
	return err;
}

describe("ConfigClient", () => {
	let client: ConfigClient;
	let configStub: Record<string, MockInstance>;
	let serverStub: Record<string, MockInstance>;

	beforeEach(async () => {
		// Get the mocked constructors.
		const configMod = await import("../src/generated/centralconfig/v1/config_service.js");
		const serverMod = await import("../src/generated/centralconfig/v1/server_service.js");

		configStub = {
			getField: vi.fn(),
			getConfig: vi.fn(),
			setField: vi.fn(),
			setFields: vi.fn(),
			close: vi.fn(),
		};

		serverStub = {
			getServerInfo: vi.fn(),
			close: vi.fn(),
		};

		// Make the constructor return our stubs (vitest 4 requires a constructable function for `new`).
		(configMod.ConfigServiceClient as unknown as MockInstance).mockImplementation(function (
			this: unknown,
		) {
			return configStub;
		});
		(serverMod.ServerServiceClient as unknown as MockInstance).mockImplementation(function (
			this: unknown,
		) {
			return serverStub;
		});

		client = new ConfigClient("localhost:9090", {
			subject: "testuser",
			retry: false,
		});
	});

	afterEach(() => {
		client.close();
		vi.restoreAllMocks();
	});

	describe("get()", () => {
		it("returns a string value by default", async () => {
			configStub.getField.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, {
						value: {
							fieldPath: "payments.fee",
							value: { stringValue: "0.5%" },
							checksum: "abc",
						},
					});
				},
			);

			const result = await client.get("tenant-1", "payments.fee");
			expect(result).toBe("0.5%");
		});

		it("converts to number when Number is passed", async () => {
			configStub.getField.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, {
						value: {
							fieldPath: "payments.retries",
							value: { integerValue: 3 },
							checksum: "abc",
						},
					});
				},
			);

			const result = await client.get("tenant-1", "payments.retries", Number);
			expect(result).toBe(3);
		});

		it("converts to boolean when Boolean is passed", async () => {
			configStub.getField.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, {
						value: {
							fieldPath: "payments.enabled",
							value: { boolValue: true },
							checksum: "abc",
						},
					});
				},
			);

			const result = await client.get("tenant-1", "payments.enabled", Boolean);
			expect(result).toBe(true);
		});

		it("returns null for nullable get when value is undefined", async () => {
			configStub.getField.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { value: undefined });
				},
			);

			const result = await client.get("tenant-1", "payments.fee", String, {
				nullable: true,
			});
			expect(result).toBeNull();
		});

		it("returns null for nullable get when TypedValue is empty", async () => {
			configStub.getField.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, {
						value: {
							fieldPath: "f",
							value: {},
							checksum: "c",
						},
					});
				},
			);

			const result = await client.get("tenant-1", "f", String, { nullable: true });
			expect(result).toBeNull();
		});

		it("throws NotFoundError when value is missing and nullable is false", async () => {
			configStub.getField.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { value: undefined });
				},
			);

			await expect(client.get("tenant-1", "payments.fee")).rejects.toThrow(NotFoundError);
		});

		it("maps gRPC errors to DecreeError", async () => {
			configStub.getField.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(makeServiceError(status.NOT_FOUND, "field not found"));
				},
			);

			await expect(client.get("tenant-1", "missing.field")).rejects.toThrow(NotFoundError);
		});
	});

	describe("getAll()", () => {
		it("returns a record of field paths to values", async () => {
			configStub.getConfig.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, {
						config: {
							tenantId: "tenant-1",
							version: 1,
							values: [
								{
									fieldPath: "a",
									value: { stringValue: "1" },
									checksum: "c1",
								},
								{
									fieldPath: "b",
									value: { integerValue: 2 },
									checksum: "c2",
								},
							],
						},
					});
				},
			);

			const result = await client.getAll("tenant-1");
			expect(result).toEqual({ a: "1", b: "2" });
		});

		it("returns empty record when config is undefined", async () => {
			configStub.getConfig.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { config: undefined });
				},
			);

			const result = await client.getAll("tenant-1");
			expect(result).toEqual({});
		});
	});

	describe("set()", () => {
		it("calls setField with string typed value", async () => {
			configStub.setField.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { configVersion: { version: 1 } });
				},
			);

			await client.set("tenant-1", "payments.fee", "0.5%");

			expect(configStub.setField).toHaveBeenCalledTimes(1);
			const callArgs = configStub.setField.mock.calls[0];
			expect(callArgs?.[0]).toEqual({
				tenantId: "tenant-1",
				fieldPath: "payments.fee",
				value: { stringValue: "0.5%" },
			});
		});

		it("maps gRPC errors", async () => {
			configStub.setField.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(makeServiceError(status.FAILED_PRECONDITION, "field locked"));
				},
			);

			await expect(client.set("tenant-1", "payments.fee", "new")).rejects.toThrow(DecreeError);
		});
	});

	describe("setMany()", () => {
		it("calls setFields with multiple updates", async () => {
			configStub.setFields.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { configVersion: { version: 2 } });
				},
			);

			await client.setMany("tenant-1", { a: "1", b: "2" }, { description: "batch" });

			expect(configStub.setFields).toHaveBeenCalledTimes(1);
			const callArgs = configStub.setFields.mock.calls[0];
			expect(callArgs?.[0]).toMatchObject({
				tenantId: "tenant-1",
				description: "batch",
			});
			expect(callArgs?.[0].updates).toHaveLength(2);
		});
	});

	describe("setNull()", () => {
		it("calls setField with undefined value", async () => {
			configStub.setField.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { configVersion: { version: 3 } });
				},
			);

			await client.setNull("tenant-1", "payments.fee");

			expect(configStub.setField).toHaveBeenCalledTimes(1);
			const callArgs = configStub.setField.mock.calls[0];
			expect(callArgs?.[0]).toEqual({
				tenantId: "tenant-1",
				fieldPath: "payments.fee",
				value: undefined,
				expectedChecksum: undefined,
			});
		});
	});

	describe("setNumber()", () => {
		it("calls setField with numberValue", async () => {
			configStub.setField.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { configVersion: { version: 1 } });
				},
			);

			await client.setNumber("tenant-1", "payments.fee", 0.05);

			const callArgs = configStub.setField.mock.calls[0];
			expect(callArgs?.[0]).toEqual({
				tenantId: "tenant-1",
				fieldPath: "payments.fee",
				value: { numberValue: 0.05 },
				expectedChecksum: undefined,
			});
		});

		it("passes expectedChecksum", async () => {
			configStub.setField.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { configVersion: { version: 1 } });
				},
			);

			await client.setNumber("tenant-1", "payments.fee", 42, { expectedChecksum: "cs1" });

			const callArgs = configStub.setField.mock.calls[0];
			expect(callArgs?.[0].expectedChecksum).toBe("cs1");
		});
	});

	describe("setBool()", () => {
		it("calls setField with boolValue", async () => {
			configStub.setField.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { configVersion: { version: 1 } });
				},
			);

			await client.setBool("tenant-1", "feature.enabled", true);

			const callArgs = configStub.setField.mock.calls[0];
			expect(callArgs?.[0]).toEqual({
				tenantId: "tenant-1",
				fieldPath: "feature.enabled",
				value: { boolValue: true },
				expectedChecksum: undefined,
			});
		});

		it("sends false correctly", async () => {
			configStub.setField.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { configVersion: { version: 1 } });
				},
			);

			await client.setBool("tenant-1", "feature.enabled", false);

			const callArgs = configStub.setField.mock.calls[0];
			expect(callArgs?.[0].value).toEqual({ boolValue: false });
		});
	});

	describe("setTime()", () => {
		it("calls setField with timeValue", async () => {
			configStub.setField.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { configVersion: { version: 1 } });
				},
			);

			const d = new Date("2024-01-15T12:00:00Z");
			await client.setTime("tenant-1", "expiry.date", d);

			const callArgs = configStub.setField.mock.calls[0];
			expect(callArgs?.[0]).toEqual({
				tenantId: "tenant-1",
				fieldPath: "expiry.date",
				value: { timeValue: d },
				expectedChecksum: undefined,
			});
		});
	});

	describe("setDuration()", () => {
		it("calls setField with stringValue for duration string", async () => {
			configStub.setField.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { configVersion: { version: 1 } });
				},
			);

			await client.setDuration("tenant-1", "cache.ttl", "1h30m");

			const callArgs = configStub.setField.mock.calls[0];
			expect(callArgs?.[0]).toEqual({
				tenantId: "tenant-1",
				fieldPath: "cache.ttl",
				value: { stringValue: "1h30m" },
				expectedChecksum: undefined,
			});
		});
	});

	describe("setMany() typed values", () => {
		it("converts mixed types to typed proto values", async () => {
			configStub.setFields.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { configVersion: { version: 2 } });
				},
			);

			const d = new Date("2024-06-01T00:00:00Z");
			await client.setMany("tenant-1", {
				"payments.fee": 0.05,
				"feature.enabled": true,
				"app.name": "myapp",
				"expiry.date": d,
			});

			const callArgs = configStub.setFields.mock.calls[0];
			const updates: Array<{ fieldPath: string; value: unknown }> = callArgs?.[0].updates;
			expect(updates.find((u) => u.fieldPath === "payments.fee")?.value).toEqual({
				numberValue: 0.05,
			});
			expect(updates.find((u) => u.fieldPath === "feature.enabled")?.value).toEqual({
				boolValue: true,
			});
			expect(updates.find((u) => u.fieldPath === "app.name")?.value).toEqual({
				stringValue: "myapp",
			});
			expect(updates.find((u) => u.fieldPath === "expiry.date")?.value).toEqual({
				timeValue: d,
			});
		});
	});

	describe("expectedChecksum plumbing", () => {
		it("set() passes expectedChecksum to proto", async () => {
			configStub.setField.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { configVersion: { version: 1 } });
				},
			);

			await client.set("tenant-1", "payments.fee", "0.5%", { expectedChecksum: "abc123" });

			const callArgs = configStub.setField.mock.calls[0];
			expect(callArgs?.[0]).toEqual({
				tenantId: "tenant-1",
				fieldPath: "payments.fee",
				value: { stringValue: "0.5%" },
				expectedChecksum: "abc123",
			});
		});

		it("set() raises ChecksumMismatchError on ABORTED", async () => {
			configStub.setField.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(makeServiceError(status.ABORTED, "checksum mismatch"));
				},
			);

			await expect(
				client.set("tenant-1", "payments.fee", "0.5%", { expectedChecksum: "stale" }),
			).rejects.toThrow(ChecksumMismatchError);
		});

		it("setMany() passes per-field expectedChecksums to proto", async () => {
			configStub.setFields.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { configVersion: { version: 2 } });
				},
			);

			await client.setMany("tenant-1", { a: "1", b: "2" }, { expectedChecksums: { a: "cs-a" } });

			const callArgs = configStub.setFields.mock.calls[0];
			const updates: Array<{ fieldPath: string; expectedChecksum?: string }> =
				callArgs?.[0].updates;
			const updateA = updates.find((u) => u.fieldPath === "a");
			const updateB = updates.find((u) => u.fieldPath === "b");
			expect(updateA?.expectedChecksum).toBe("cs-a");
			expect(updateB?.expectedChecksum).toBeUndefined();
		});

		it("setMany() raises ChecksumMismatchError on ABORTED", async () => {
			configStub.setFields.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(makeServiceError(status.ABORTED, "checksum mismatch"));
				},
			);

			await expect(
				client.setMany("tenant-1", { a: "1" }, { expectedChecksums: { a: "stale" } }),
			).rejects.toThrow(ChecksumMismatchError);
		});

		it("setNull() passes expectedChecksum to proto", async () => {
			configStub.setField.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { configVersion: { version: 3 } });
				},
			);

			await client.setNull("tenant-1", "payments.fee", { expectedChecksum: "xyz" });

			const callArgs = configStub.setField.mock.calls[0];
			expect(callArgs?.[0]).toEqual({
				tenantId: "tenant-1",
				fieldPath: "payments.fee",
				value: undefined,
				expectedChecksum: "xyz",
			});
		});

		it("setNull() raises ChecksumMismatchError on ABORTED", async () => {
			configStub.setField.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(makeServiceError(status.ABORTED, "checksum mismatch"));
				},
			);

			await expect(
				client.setNull("tenant-1", "payments.fee", { expectedChecksum: "stale" }),
			).rejects.toThrow(ChecksumMismatchError);
		});
	});

	describe("serverInfo", () => {
		it("fetches and caches server info", async () => {
			serverStub.getServerInfo.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, {
						version: "0.8.0",
						commit: "abc123",
						features: { config: true, schema: true },
					});
				},
			);

			const v1 = await client.serverInfo;
			const v2 = await client.serverInfo;

			expect(v1).toEqual({
				version: "0.8.0",
				commit: "abc123",
				features: { config: true, schema: true },
			});
			expect(v2).toBe(v1); // same promise
			expect(serverStub.getServerInfo).toHaveBeenCalledTimes(1);
		});

		it("maps gRPC errors from server service", async () => {
			serverStub.getServerInfo.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(makeServiceError(status.UNAVAILABLE, "server down"));
				},
			);

			await expect(client.serverInfo).rejects.toThrow(UnavailableError);
		});

		it("clears cached promise on rejection so callers can retry", async () => {
			serverStub.getServerInfo
				.mockImplementationOnce(
					(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
						cb(makeServiceError(status.UNAVAILABLE, "server down"));
					},
				)
				.mockImplementationOnce(
					(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
						cb(null, { version: "0.9.0", commit: "def456", features: {} });
					},
				);

			await expect(client.serverInfo).rejects.toThrow(UnavailableError);
			// allow the .catch cleanup to run
			await Promise.resolve();
			const info = await client.serverInfo;
			expect(info.version).toBe("0.9.0");
			expect(serverStub.getServerInfo).toHaveBeenCalledTimes(2);
		});

		it("exposes deprecated serverVersion alias", async () => {
			serverStub.getServerInfo.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { version: "0.8.0", commit: "abc123", features: {} });
				},
			);

			const sv = await client.serverVersion;
			expect(sv.version).toBe("0.8.0");
		});
	});

	describe("checkCompatibility()", () => {
		it("succeeds for compatible version", async () => {
			serverStub.getServerInfo.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { version: "0.8.0", commit: "abc", features: {} });
				},
			);

			await expect(client.checkCompatibility()).resolves.toBeUndefined();
		});

		it("throws IncompatibleServerError for bad version", async () => {
			serverStub.getServerInfo.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { version: "0.1.0", commit: "abc", features: {} });
				},
			);

			await expect(client.checkCompatibility()).rejects.toThrow(IncompatibleServerError);
		});
	});

	describe("watch()", () => {
		it("returns a ConfigWatcher instance", () => {
			const watcher = client.watch("tenant-1");
			expect(watcher).toBeDefined();
			expect(typeof watcher.field).toBe("function");
			expect(typeof watcher.start).toBe("function");
			expect(typeof watcher.stop).toBe("function");
		});
	});

	describe("close()", () => {
		it("closes both stubs", () => {
			client.close();
			expect(configStub.close).toHaveBeenCalledTimes(1);
			expect(serverStub.close).toHaveBeenCalledTimes(1);
		});
	});

	describe("Symbol.dispose", () => {
		it("calls close()", () => {
			client[Symbol.dispose]();
			expect(configStub.close).toHaveBeenCalledTimes(1);
			expect(serverStub.close).toHaveBeenCalledTimes(1);
		});
	});

	describe("Symbol.asyncDispose", () => {
		it("closes both stubs and resolves", async () => {
			await client[Symbol.asyncDispose]();
			expect(configStub.close).toHaveBeenCalledTimes(1);
			expect(serverStub.close).toHaveBeenCalledTimes(1);
		});

		it("works with await using", async () => {
			// biome-ignore lint/suspicious/useAwait: await using satisfies the await requirement but biome doesn't recognise it yet
			await (async () => {
				await using c = client;
				void c;
			})();
			expect(configStub.close).toHaveBeenCalledTimes(1);
			expect(serverStub.close).toHaveBeenCalledTimes(1);
		});
	});

	describe("per-call timeout", () => {
		it("get() uses per-call timeout over client default", async () => {
			let capturedDeadline: number | undefined;
			const before = Date.now();
			configStub.getField.mockImplementation(
				(
					_req: unknown,
					_meta: unknown,
					opts: { deadline?: number },
					cb: (...args: unknown[]) => void,
				) => {
					capturedDeadline = opts.deadline;
					cb(null, {
						value: { fieldPath: "f", value: { stringValue: "v" }, checksum: "c" },
					});
				},
			);

			await client.get("tenant-1", "f", String, { timeout: 500 });

			expect(capturedDeadline).toBeGreaterThanOrEqual(before + 500);
			expect(capturedDeadline).toBeLessThan(before + 10_000);
		});

		it("getAll() uses per-call timeout over client default", async () => {
			let capturedDeadline: number | undefined;
			const before = Date.now();
			configStub.getConfig.mockImplementation(
				(
					_req: unknown,
					_meta: unknown,
					opts: { deadline?: number },
					cb: (...args: unknown[]) => void,
				) => {
					capturedDeadline = opts.deadline;
					cb(null, { config: { tenantId: "t", version: 1, values: [] } });
				},
			);

			await client.getAll("tenant-1", { timeout: 500 });

			expect(capturedDeadline).toBeGreaterThanOrEqual(before + 500);
			expect(capturedDeadline).toBeLessThan(before + 10_000);
		});

		it("set() uses per-call timeout over client default", async () => {
			let capturedDeadline: number | undefined;
			const before = Date.now();
			configStub.setField.mockImplementation(
				(
					_req: unknown,
					_meta: unknown,
					opts: { deadline?: number },
					cb: (...args: unknown[]) => void,
				) => {
					capturedDeadline = opts.deadline;
					cb(null, { configVersion: { version: 1 } });
				},
			);

			await client.set("tenant-1", "f", "v", { timeout: 500 });

			expect(capturedDeadline).toBeGreaterThanOrEqual(before + 500);
			expect(capturedDeadline).toBeLessThan(before + 10_000);
		});

		it("setMany() uses per-call timeout over client default", async () => {
			let capturedDeadline: number | undefined;
			const before = Date.now();
			configStub.setFields.mockImplementation(
				(
					_req: unknown,
					_meta: unknown,
					opts: { deadline?: number },
					cb: (...args: unknown[]) => void,
				) => {
					capturedDeadline = opts.deadline;
					cb(null, { configVersion: { version: 1 } });
				},
			);

			await client.setMany("tenant-1", { f: "v" }, { timeout: 500 });

			expect(capturedDeadline).toBeGreaterThanOrEqual(before + 500);
			expect(capturedDeadline).toBeLessThan(before + 10_000);
		});

		it("setNull() uses per-call timeout over client default", async () => {
			let capturedDeadline: number | undefined;
			const before = Date.now();
			configStub.setField.mockImplementation(
				(
					_req: unknown,
					_meta: unknown,
					opts: { deadline?: number },
					cb: (...args: unknown[]) => void,
				) => {
					capturedDeadline = opts.deadline;
					cb(null, { configVersion: { version: 1 } });
				},
			);

			await client.setNull("tenant-1", "f", { timeout: 500 });

			expect(capturedDeadline).toBeGreaterThanOrEqual(before + 500);
			expect(capturedDeadline).toBeLessThan(before + 10_000);
		});

		it("falls back to client default when no per-call timeout", async () => {
			let capturedDeadline: number | undefined;
			const clientWithTimeout = new ConfigClient("localhost:9090", {
				subject: "u",
				timeout: 3000,
				retry: false,
			});
			const before = Date.now();
			configStub.getField.mockImplementation(
				(
					_req: unknown,
					_meta: unknown,
					opts: { deadline?: number },
					cb: (...args: unknown[]) => void,
				) => {
					capturedDeadline = opts.deadline;
					cb(null, {
						value: { fieldPath: "f", value: { stringValue: "v" }, checksum: "c" },
					});
				},
			);

			await clientWithTimeout.get("tenant-1", "f");
			clientWithTimeout.close();

			expect(capturedDeadline).toBeGreaterThanOrEqual(before + 3000);
			expect(capturedDeadline).toBeLessThan(before + 10_000);
		});
	});

	describe("auth metadata", () => {
		it("sets subject and role metadata headers", async () => {
			configStub.getField.mockImplementation(
				(_req: unknown, meta: Metadata, _opts: unknown, cb: (...args: unknown[]) => void) => {
					expect(meta.get("x-subject")).toEqual(["testuser"]);
					expect(meta.get("x-role")).toEqual(["superadmin"]);
					cb(null, {
						value: {
							fieldPath: "a",
							value: { stringValue: "v" },
							checksum: "c",
						},
					});
				},
			);

			await client.get("tenant-1", "a");
		});

		it("sets Bearer token when token is provided", () => {
			const tokenClient = new ConfigClient("localhost:9090", {
				token: "my-jwt-token",
				retry: false,
			});
			// Client was constructed — token branch was executed
			tokenClient.close();
		});

		it("sets x-tenant-id when tenantId is provided", () => {
			const tenantClient = new ConfigClient("localhost:9090", {
				subject: "user",
				tenantId: "t1",
				retry: false,
			});
			tenantClient.close();
		});

		describe("setToken()", () => {
			it("subsequent RPCs use the new Bearer token", async () => {
				client.setToken("rotated-token");

				configStub.getField.mockImplementation(
					(_req: unknown, meta: Metadata, _opts: unknown, cb: (...args: unknown[]) => void) => {
						expect(meta.get("authorization")).toEqual(["Bearer rotated-token"]);
						cb(null, {
							value: { fieldPath: "a", value: { stringValue: "v" }, checksum: "c" },
						});
					},
				);

				await client.get("tenant-1", "a");
			});

			it("clears metadata headers when switching from header-mode to token-mode", async () => {
				client.setToken("jwt-abc");

				configStub.getField.mockImplementation(
					(_req: unknown, meta: Metadata, _opts: unknown, cb: (...args: unknown[]) => void) => {
						expect(meta.get("x-subject")).toEqual([]);
						expect(meta.get("x-role")).toEqual([]);
						expect(meta.get("authorization")).toEqual(["Bearer jwt-abc"]);
						cb(null, {
							value: { fieldPath: "a", value: { stringValue: "v" }, checksum: "c" },
						});
					},
				);

				await client.get("tenant-1", "a");
			});

			it("rotates token on a token-mode client", async () => {
				const tokenClient = new ConfigClient("localhost:9090", {
					token: "initial-token",
					retry: false,
				});

				tokenClient.setToken("refreshed-token");

				configStub.getField.mockImplementation(
					(_req: unknown, meta: Metadata, _opts: unknown, cb: (...args: unknown[]) => void) => {
						expect(meta.get("authorization")).toEqual(["Bearer refreshed-token"]);
						cb(null, {
							value: { fieldPath: "a", value: { stringValue: "v" }, checksum: "c" },
						});
					},
				);

				await tokenClient.get("tenant-1", "a");
				tokenClient.close();
			});
		});
	});

	describe("AbortSignal", () => {
		function makeCancellableStub(mock: MockInstance) {
			mock.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => ({
					cancel: () => cb(makeServiceError(status.CANCELLED, "rpc cancelled"), undefined),
				}),
			);
		}

		it("get() cancels the in-flight call when signal is aborted", async () => {
			makeCancellableStub(configStub.getField);
			const controller = new AbortController();
			const p = client.get("tenant-1", "f", String, { signal: controller.signal });
			controller.abort();
			await expect(p).rejects.toThrow(DecreeError);
		});

		it("getAll() cancels the in-flight call when signal is aborted", async () => {
			makeCancellableStub(configStub.getConfig);
			const controller = new AbortController();
			const p = client.getAll("tenant-1", { signal: controller.signal });
			controller.abort();
			await expect(p).rejects.toThrow(DecreeError);
		});

		it("set() cancels the in-flight call when signal is aborted", async () => {
			makeCancellableStub(configStub.setField);
			const controller = new AbortController();
			const p = client.set("tenant-1", "f", "v", { signal: controller.signal });
			controller.abort();
			await expect(p).rejects.toThrow(DecreeError);
		});

		it("setMany() cancels the in-flight call when signal is aborted", async () => {
			makeCancellableStub(configStub.setFields);
			const controller = new AbortController();
			const p = client.setMany("tenant-1", { f: "v" }, { signal: controller.signal });
			controller.abort();
			await expect(p).rejects.toThrow(DecreeError);
		});

		it("setNull() cancels the in-flight call when signal is aborted", async () => {
			makeCancellableStub(configStub.setField);
			const controller = new AbortController();
			const p = client.setNull("tenant-1", "f", { signal: controller.signal });
			controller.abort();
			await expect(p).rejects.toThrow(DecreeError);
		});
	});

	describe("TLS channel", () => {
		it("creates TLS channel by default", () => {
			const c = new ConfigClient("localhost:9090", { retry: false });
			c.close();
		});

		it("creates insecure channel when insecure is true", () => {
			const c = new ConfigClient("localhost:9090", { insecure: true, retry: false });
			c.close();
		});

		it("warns when insecure is true and a token is configured", () => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const c = new ConfigClient("localhost:9090", {
				insecure: true,
				token: "secret",
				retry: false,
			});
			c.close();
			expect(warn).toHaveBeenCalledOnce();
			expect(warn.mock.calls[0][0]).toContain("cleartext");
			warn.mockRestore();
		});

		it("creates TLS channel with custom root CA", () => {
			const rootCerts = Buffer.from(
				"-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n",
			);
			const c = new ConfigClient("localhost:9090", {
				tls: { rootCerts },
				retry: false,
			});
			c.close();
		});

		it("creates TLS channel with mTLS client cert", async () => {
			const grpcCredentials = await import("@grpc/grpc-js");
			const createSsl = vi
				.spyOn(grpcCredentials.credentials, "createSsl")
				.mockReturnValue(
					grpcCredentials.credentials.createInsecure() as ReturnType<
						typeof grpcCredentials.credentials.createSsl
					>,
				);
			const rootCerts = Buffer.from("fake-ca");
			const privateKey = Buffer.from("fake-key");
			const certChain = Buffer.from("fake-cert");
			const c = new ConfigClient("localhost:9090", {
				tls: { rootCerts, privateKey, certChain },
				retry: false,
			});
			c.close();
			expect(createSsl).toHaveBeenCalledWith(rootCerts, privateKey, certChain);
			createSsl.mockRestore();
		});

		it("ignores tls option when insecure is true", () => {
			const rootCerts = Buffer.from(
				"-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n",
			);
			const c = new ConfigClient("localhost:9090", {
				insecure: true,
				tls: { rootCerts },
				retry: false,
			});
			c.close();
		});
	});

	describe("retry behavior", () => {
		let retryClient: ConfigClient;

		beforeEach(() => {
			retryClient = new ConfigClient("localhost:9090", {
				subject: "testuser",
				retry: {}, // enabled, no custom retryableCodes → hits line 514
			});
		});

		afterEach(() => {
			retryClient.close();
		});

		it("withRetryAndMap merges defaultCodes into config when retryableCodes is unset (line 514)", async () => {
			configStub.getField.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { value: { fieldPath: "f", value: { stringValue: "v" }, checksum: "c" } });
				},
			);
			const result = await retryClient.get("tenant-1", "f");
			expect(result).toBe("v");
		});
	});

	describe("idempotency key retry", () => {
		let retryClient: ConfigClient;

		beforeEach(() => {
			retryClient = new ConfigClient("localhost:9090", {
				subject: "testuser",
				retry: { maxAttempts: 2, initialBackoff: 1 },
			});
		});

		afterEach(() => {
			retryClient.close();
		});

		it("set() with idempotencyKey retries DEADLINE_EXCEEDED", async () => {
			vi.useFakeTimers();

			configStub.setField
				.mockImplementationOnce(
					(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
						cb(makeServiceError(status.DEADLINE_EXCEEDED, "timed out"));
					},
				)
				.mockImplementationOnce(
					(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
						cb(null, { configVersion: { version: 1 } });
					},
				);

			const promise = retryClient.set("tenant-1", "payments.fee", "0.5%", {
				idempotencyKey: "idem-key-1",
			});
			await vi.runAllTimersAsync();
			await promise;

			expect(configStub.setField).toHaveBeenCalledTimes(2);

			vi.useRealTimers();
		});

		it("set() without idempotencyKey does NOT retry DEADLINE_EXCEEDED", async () => {
			configStub.setField.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(makeServiceError(status.DEADLINE_EXCEEDED, "timed out"));
				},
			);

			await expect(retryClient.set("tenant-1", "payments.fee", "0.5%")).rejects.toThrow(
				DeadlineExceededError,
			);

			expect(configStub.setField).toHaveBeenCalledTimes(1);
		});

		it("setMany() with idempotencyKey retries DEADLINE_EXCEEDED", async () => {
			vi.useFakeTimers();

			configStub.setFields
				.mockImplementationOnce(
					(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
						cb(makeServiceError(status.DEADLINE_EXCEEDED, "timed out"));
					},
				)
				.mockImplementationOnce(
					(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
						cb(null, { configVersion: { version: 2 } });
					},
				);

			const promise = retryClient.setMany("tenant-1", { a: "1" }, { idempotencyKey: "idem-key-2" });
			await vi.runAllTimersAsync();
			await promise;

			expect(configStub.setFields).toHaveBeenCalledTimes(2);

			vi.useRealTimers();
		});

		it("setNull() with idempotencyKey retries DEADLINE_EXCEEDED", async () => {
			vi.useFakeTimers();

			configStub.setField
				.mockImplementationOnce(
					(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
						cb(makeServiceError(status.DEADLINE_EXCEEDED, "timed out"));
					},
				)
				.mockImplementationOnce(
					(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
						cb(null, { configVersion: { version: 3 } });
					},
				);

			const promise = retryClient.setNull("tenant-1", "payments.fee", {
				idempotencyKey: "idem-key-3",
			});
			await vi.runAllTimersAsync();
			await promise;

			expect(configStub.setField).toHaveBeenCalledTimes(2);

			vi.useRealTimers();
		});

		it("setNumber() with idempotencyKey retries DEADLINE_EXCEEDED", async () => {
			vi.useFakeTimers();

			configStub.setField
				.mockImplementationOnce(
					(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
						cb(makeServiceError(status.DEADLINE_EXCEEDED, "timed out"));
					},
				)
				.mockImplementationOnce(
					(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
						cb(null, { configVersion: { version: 1 } });
					},
				);

			const promise = retryClient.setNumber("tenant-1", "payments.fee", 42, {
				idempotencyKey: "idem-key-4",
			});
			await vi.runAllTimersAsync();
			await promise;

			expect(configStub.setField).toHaveBeenCalledTimes(2);

			vi.useRealTimers();
		});
	});
});
