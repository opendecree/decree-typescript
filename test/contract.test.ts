/**
 * Contract tests against a real grpc-js server.
 *
 * These tests use the actual generated stubs and a minimal in-process grpc-js
 * server so that proto serialization / deserialization is exercised end-to-end.
 * Mock-based tests in client.test.ts cover error-mapping logic in isolation;
 * these tests verify that the wire encoding of requests and responses is correct.
 */

import { Metadata, Server, ServerCredentials, status } from "@grpc/grpc-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigClient } from "../src/client.js";
import { NotFoundError } from "../src/errors.js";
import { ConfigServiceService } from "../src/generated/centralconfig/v1/config_service.js";
import { ServerServiceService } from "../src/generated/centralconfig/v1/server_service.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bindServer(server: Server): Promise<number> {
	return new Promise((resolve, reject) => {
		server.bindAsync("127.0.0.1:0", ServerCredentials.createInsecure(), (err, port) => {
			if (err) reject(err);
			else resolve(port);
		});
	});
}

function shutdownServer(server: Server): Promise<void> {
	return new Promise((resolve) => server.tryShutdown(resolve));
}

const unimplErr = {
	code: status.UNIMPLEMENTED,
	details: "not implemented",
	metadata: new Metadata(),
};

const unimpl = (_: unknown, cb: (err: unknown, res: null) => void) => cb(unimplErr, null);

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

describe("contract", () => {
	let server: Server;
	let client: ConfigClient;

	// Per-test mutable handlers — each test sets these to control server behaviour.
	let handleGetConfig: (req: unknown, cb: (err: unknown, res: unknown) => void) => void;
	let handleGetField: (req: unknown, cb: (err: unknown, res: unknown) => void) => void;
	let handleSetField: (req: unknown, cb: (err: unknown, res: unknown) => void) => void;
	let handleSetFields: (req: unknown, cb: (err: unknown, res: unknown) => void) => void;
	let handleSubscribe: (call: { write: (r: unknown) => void; end: () => void }) => void;

	beforeEach(async () => {
		handleGetConfig = unimpl;
		handleGetField = unimpl;
		handleSetField = unimpl;
		handleSetFields = unimpl;
		handleSubscribe = (call) => call.end();

		server = new Server();

		server.addService(ConfigServiceService, {
			getConfig: (call: { request: unknown }, cb: (e: unknown, r: unknown) => void) =>
				handleGetConfig(call.request, cb),
			getField: (call: { request: unknown }, cb: (e: unknown, r: unknown) => void) =>
				handleGetField(call.request, cb),
			getFields: unimpl,
			setField: (call: { request: unknown }, cb: (e: unknown, r: unknown) => void) =>
				handleSetField(call.request, cb),
			setFields: (call: { request: unknown }, cb: (e: unknown, r: unknown) => void) =>
				handleSetFields(call.request, cb),
			listVersions: unimpl,
			getVersion: unimpl,
			rollbackToVersion: unimpl,
			subscribe: (call: { write: (r: unknown) => void; end: () => void }) => handleSubscribe(call),
			exportConfig: unimpl,
			importConfig: unimpl,
		});

		server.addService(ServerServiceService, {
			getServerInfo: (_call: unknown, cb: (e: unknown, r: unknown) => void) =>
				cb(null, { version: "0.8.0", commit: "test", features: {} }),
		});

		const port = await bindServer(server);
		client = new ConfigClient(`127.0.0.1:${port}`, {
			insecure: true,
			subject: "testuser",
			retry: false,
		});
	});

	afterEach(async () => {
		client.close();
		await shutdownServer(server);
	});

	// -------------------------------------------------------------------------
	// get / getField
	// -------------------------------------------------------------------------

	describe("get() — round-trip through proto serialization", () => {
		it("decodes a string value", async () => {
			let received: Record<string, unknown> | undefined;
			handleGetField = (req, cb) => {
				received = req as Record<string, unknown>;
				cb(null, {
					value: {
						fieldPath: (req as { fieldPath: string }).fieldPath,
						value: { stringValue: "hello-world" },
						checksum: "abc",
					},
				});
			};

			const result = await client.get("tenant-1", "payments.fee");

			expect(result).toBe("hello-world");
			expect(received?.tenantId).toBe("tenant-1");
			expect(received?.fieldPath).toBe("payments.fee");
		});

		it("decodes an integer value when Number is requested", async () => {
			handleGetField = (req, cb) =>
				cb(null, {
					value: {
						fieldPath: (req as { fieldPath: string }).fieldPath,
						value: { integerValue: 42 },
						checksum: "c1",
					},
				});

			const result = await client.get("tenant-1", "count", Number);
			expect(result).toBe(42);
		});

		it("decodes a boolean value when Boolean is requested", async () => {
			handleGetField = (req, cb) =>
				cb(null, {
					value: {
						fieldPath: (req as { fieldPath: string }).fieldPath,
						value: { boolValue: true },
						checksum: "c2",
					},
				});

			const result = await client.get("tenant-1", "feature.on", Boolean);
			expect(result).toBe(true);
		});

		it("raises NotFoundError on gRPC NOT_FOUND from real server", async () => {
			handleGetField = (_, cb) =>
				cb({ code: status.NOT_FOUND, details: "no such field", metadata: new Metadata() }, null);

			await expect(client.get("tenant-1", "missing")).rejects.toThrow(NotFoundError);
		});
	});

	// -------------------------------------------------------------------------
	// set / setField
	// -------------------------------------------------------------------------

	describe("set() — request proto reaches server correctly", () => {
		const okVersion = {
			configVersion: {
				id: "v1",
				tenantId: "tenant-1",
				version: 1,
				description: "",
				createdBy: "testuser",
				createdAt: new Date(),
			},
		};

		it("sends stringValue for a string", async () => {
			let received: Record<string, unknown> | undefined;
			handleSetField = (req, cb) => {
				received = req as Record<string, unknown>;
				cb(null, okVersion);
			};

			await client.set("tenant-1", "payments.fee", "0.5%");

			expect(received?.tenantId).toBe("tenant-1");
			expect(received?.fieldPath).toBe("payments.fee");
			expect(received?.value).toMatchObject({ stringValue: "0.5%" });
		});

		it("sends numberValue for a number (via setNumber)", async () => {
			let received: Record<string, unknown> | undefined;
			handleSetField = (req, cb) => {
				received = req as Record<string, unknown>;
				cb(null, okVersion);
			};

			await client.setNumber("tenant-1", "payments.rate", 0.05);

			expect(received?.value).toMatchObject({ numberValue: 0.05 });
		});

		it("sends boolValue for a boolean (via setBool)", async () => {
			let received: Record<string, unknown> | undefined;
			handleSetField = (req, cb) => {
				received = req as Record<string, unknown>;
				cb(null, okVersion);
			};

			await client.setBool("tenant-1", "feature.enabled", false);

			expect(received?.value).toMatchObject({ boolValue: false });
		});

		it("sends undefined value for setNull", async () => {
			let received: Record<string, unknown> | undefined;
			handleSetField = (req, cb) => {
				received = req as Record<string, unknown>;
				cb(null, okVersion);
			};

			await client.setNull("tenant-1", "payments.fee");

			expect(received?.value).toBeUndefined();
		});
	});

	// -------------------------------------------------------------------------
	// setMany / setFields
	// -------------------------------------------------------------------------

	describe("setMany() — batch request reaches server correctly", () => {
		it("sends multiple typed updates in one RPC", async () => {
			let received: Record<string, unknown> | undefined;
			handleSetFields = (req, cb) => {
				received = req as Record<string, unknown>;
				cb(null, {
					configVersion: {
						id: "v2",
						tenantId: "tenant-1",
						version: 2,
						description: "",
						createdBy: "testuser",
						createdAt: new Date(),
					},
				});
			};

			await client.setMany("tenant-1", { a: "hello", b: 42, c: true });

			const updates = received?.updates as Array<{ fieldPath: string; value: unknown }>;
			expect(updates).toHaveLength(3);
			expect(updates.find((u) => u.fieldPath === "a")?.value).toMatchObject({
				stringValue: "hello",
			});
			expect(updates.find((u) => u.fieldPath === "b")?.value).toMatchObject({ numberValue: 42 });
			expect(updates.find((u) => u.fieldPath === "c")?.value).toMatchObject({ boolValue: true });
		});
	});

	// -------------------------------------------------------------------------
	// watch — ConfigWatcher + Subscribe stream
	// -------------------------------------------------------------------------

	describe("watch() — ConfigWatcher against real server", () => {
		it("loads initial snapshot from GetConfig and receives Subscribe change", async () => {
			handleGetConfig = (_req, cb) =>
				cb(null, {
					config: {
						tenantId: "tenant-1",
						version: 1,
						values: [
							{
								fieldPath: "payments.fee",
								value: { stringValue: "0.05" },
								checksum: "c1",
							},
						],
					},
				});

			// Capture the subscribe call so we can push changes manually.
			// We need a promise to wait for the server-side handler to be invoked
			// because subscribe() is fire-and-forget from start() and the server
			// processes the incoming stream asynchronously.
			let subscribeCall: { write: (r: unknown) => void; end: () => void } | undefined;
			let notifySubscribeReady: () => void;
			const subscribeReady = new Promise<void>((resolve) => {
				notifySubscribeReady = resolve;
			});
			handleSubscribe = (call) => {
				subscribeCall = call;
				notifySubscribeReady();
				// Keep stream open — the test controls when to send.
			};

			const watcher = client.watch("tenant-1");
			const fee = watcher.field("payments.fee", Number, { default: 0 });
			await watcher.start();

			// Initial value loaded from snapshot.
			expect(fee.value).toBe(0.05);

			// Wait for the server-side subscribe handler to be called.
			await subscribeReady;

			// Push a change through the real Subscribe stream.
			const changeArrived = new Promise<void>((resolve) => {
				fee.on("change", () => resolve());
			});

			if (!subscribeCall) throw new Error("subscribe handler not called");
			subscribeCall.write({
				change: {
					tenantId: "tenant-1",
					version: 2,
					fieldPath: "payments.fee",
					oldValue: { stringValue: "0.05" },
					newValue: { stringValue: "0.1" },
					changedBy: "test",
					changedAt: new Date(),
				},
			});

			await changeArrived;
			expect(fee.value).toBe(0.1);

			await watcher.stop();
		});

		it("field uses default when field is absent from initial snapshot", async () => {
			handleGetConfig = (_req, cb) =>
				cb(null, {
					config: { tenantId: "tenant-1", version: 1, values: [] },
				});

			const watcher = client.watch("tenant-1");
			const flag = watcher.field("feature.enabled", Boolean, { default: false });
			await watcher.start();

			expect(flag.value).toBe(false);

			await watcher.stop();
		});
	});
});
