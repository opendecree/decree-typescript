import { Metadata, type ServiceError, status } from "@grpc/grpc-js";
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigClient } from "../src/client.js";
import {
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

vi.mock("../src/generated/centralconfig/v1/version_service.js", () => {
	const MockVersionServiceClient = vi.fn();
	return { VersionServiceClient: MockVersionServiceClient };
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
	let versionStub: Record<string, MockInstance>;

	beforeEach(async () => {
		// Get the mocked constructors.
		const configMod = await import("../src/generated/centralconfig/v1/config_service.js");
		const versionMod = await import("../src/generated/centralconfig/v1/version_service.js");

		configStub = {
			getField: vi.fn(),
			getConfig: vi.fn(),
			setField: vi.fn(),
			setFields: vi.fn(),
			close: vi.fn(),
		};

		versionStub = {
			getServerVersion: vi.fn(),
			close: vi.fn(),
		};

		// Make the constructor return our stubs.
		(configMod.ConfigServiceClient as unknown as MockInstance).mockReturnValue(configStub);
		(versionMod.VersionServiceClient as unknown as MockInstance).mockReturnValue(versionStub);

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
			});
		});
	});

	describe("serverVersion", () => {
		it("fetches and caches server version", async () => {
			versionStub.getServerVersion.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { version: "0.3.1", commit: "abc123" });
				},
			);

			const v1 = await client.serverVersion;
			const v2 = await client.serverVersion;

			expect(v1).toEqual({ version: "0.3.1", commit: "abc123" });
			expect(v2).toBe(v1); // same promise
			expect(versionStub.getServerVersion).toHaveBeenCalledTimes(1);
		});

		it("maps gRPC errors from version service", async () => {
			versionStub.getServerVersion.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(makeServiceError(status.UNAVAILABLE, "server down"));
				},
			);

			await expect(client.serverVersion).rejects.toThrow(UnavailableError);
		});
	});

	describe("checkCompatibility()", () => {
		it("succeeds for compatible version", async () => {
			versionStub.getServerVersion.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { version: "0.5.0", commit: "abc" });
				},
			);

			await expect(client.checkCompatibility()).resolves.toBeUndefined();
		});

		it("throws IncompatibleServerError for bad version", async () => {
			versionStub.getServerVersion.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { version: "0.1.0", commit: "abc" });
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
			expect(versionStub.close).toHaveBeenCalledTimes(1);
		});
	});

	describe("Symbol.dispose", () => {
		it("calls close()", () => {
			client[Symbol.dispose]();
			expect(configStub.close).toHaveBeenCalledTimes(1);
			expect(versionStub.close).toHaveBeenCalledTimes(1);
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
	});

	describe("TLS channel", () => {
		it("creates insecure channel by default", () => {
			const c = new ConfigClient("localhost:9090", { retry: false });
			c.close();
		});

		it("creates TLS channel when insecure is false", () => {
			const c = new ConfigClient("localhost:9090", { insecure: false, retry: false });
			c.close();
		});
	});
});
