import { EventEmitter } from "node:events";
import { Metadata, type ServiceError, status } from "@grpc/grpc-js";
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DecreeError } from "../src/errors.js";
import type { Change } from "../src/types.js";
import { ConfigWatcher, WatchedField } from "../src/watcher.js";

// Mock the generated gRPC client constructor.
vi.mock("../src/generated/centralconfig/v1/config_service.js", () => {
	const MockConfigServiceClient = vi.fn();
	return { ConfigServiceClient: MockConfigServiceClient };
});

function makeServiceError(code: number, details: string): ServiceError {
	const err = new Error(details) as ServiceError;
	err.code = code;
	err.details = details;
	err.metadata = new Metadata();
	return err;
}

/**
 * Create a mock stream that behaves like a ClientReadableStream.
 * Uses EventEmitter so we can emit 'data', 'error', 'end' from tests.
 */
function createMockStream(): EventEmitter & { cancel: MockInstance } {
	const stream = new EventEmitter() as EventEmitter & { cancel: MockInstance };
	stream.cancel = vi.fn();
	return stream;
}

describe("WatchedField", () => {
	it("returns default value before any updates", () => {
		const field = new WatchedField("payments.fee", Number, { default: 0.01 });
		expect(field.value).toBe(0.01);
	});

	it("loads initial value from snapshot", () => {
		const field = new WatchedField("payments.fee", Number, { default: 0.01 });
		field._loadInitial("0.05");
		expect(field.value).toBe(0.05);
	});

	it("resets to default when initial value is null", () => {
		const field = new WatchedField("payments.fee", Number, { default: 0.01 });
		field._loadInitial("0.05");
		expect(field.value).toBe(0.05);
		field._loadInitial(null);
		expect(field.value).toBe(0.01);
	});

	it("updates value and fires change event", () => {
		const field = new WatchedField("payments.fee", Number, { default: 0.01 });
		field._loadInitial("0.05");

		const handler = vi.fn();
		field.on("change", handler);

		const change: Change = {
			fieldPath: "payments.fee",
			oldValue: "0.05",
			newValue: "0.10",
			version: 2,
			changedBy: "admin",
		};
		field._update("0.10", change);

		expect(field.value).toBe(0.1);
		expect(handler).toHaveBeenCalledOnce();
		expect(handler).toHaveBeenCalledWith(0.05, 0.1);
	});

	it("does not fire change event when value is unchanged", () => {
		const field = new WatchedField("payments.fee", Number, { default: 0.01 });
		field._loadInitial("0.05");

		const handler = vi.fn();
		field.on("change", handler);

		const change: Change = {
			fieldPath: "payments.fee",
			oldValue: "0.05",
			newValue: "0.05",
			version: 2,
			changedBy: "admin",
		};
		field._update("0.05", change);

		expect(field.value).toBe(0.05);
		expect(handler).not.toHaveBeenCalled();
	});

	it("resets to default when updated with null", () => {
		const field = new WatchedField("payments.fee", Number, { default: 0.01 });
		field._loadInitial("0.05");

		const handler = vi.fn();
		field.on("change", handler);

		const change: Change = {
			fieldPath: "payments.fee",
			oldValue: "0.05",
			newValue: null,
			version: 3,
			changedBy: "admin",
		};
		field._update(null, change);

		expect(field.value).toBe(0.01);
		expect(handler).toHaveBeenCalledOnce();
		expect(handler).toHaveBeenCalledWith(0.05, 0.01);
	});

	it("works with boolean converter", () => {
		const field = new WatchedField("feature.enabled", Boolean, { default: false });
		field._loadInitial("true");
		expect(field.value).toBe(true);

		const change: Change = {
			fieldPath: "feature.enabled",
			oldValue: "true",
			newValue: "false",
			version: 2,
			changedBy: "admin",
		};
		field._update("false", change);
		expect(field.value).toBe(false);
	});

	it("works with string converter", () => {
		const field = new WatchedField("app.name", String, { default: "default" });
		field._loadInitial("myapp");
		expect(field.value).toBe("myapp");
	});

	describe("async iteration", () => {
		it("yields changes via for-await-of", async () => {
			const field = new WatchedField("payments.fee", Number, { default: 0.01 });
			field._loadInitial("0.05");

			const changes: Change[] = [];
			const iterPromise = (async () => {
				for await (const change of field) {
					changes.push(change);
					if (changes.length === 2) break;
				}
			})();

			// Give the iterator time to start waiting.
			await new Promise((r) => setTimeout(r, 10));

			const change1: Change = {
				fieldPath: "payments.fee",
				oldValue: "0.05",
				newValue: "0.10",
				version: 2,
				changedBy: "admin",
			};
			field._update("0.10", change1);

			const change2: Change = {
				fieldPath: "payments.fee",
				oldValue: "0.10",
				newValue: "0.20",
				version: 3,
				changedBy: "admin",
			};
			field._update("0.20", change2);

			await iterPromise;
			expect(changes).toHaveLength(2);
			expect(changes[0]?.newValue).toBe("0.10");
			expect(changes[1]?.newValue).toBe("0.20");
		});

		it("ends iteration when stopped", async () => {
			const field = new WatchedField("payments.fee", Number, { default: 0.01 });

			const changes: Change[] = [];
			const iterPromise = (async () => {
				for await (const change of field) {
					changes.push(change);
				}
			})();

			// Give the iterator time to start waiting.
			await new Promise((r) => setTimeout(r, 10));

			field._stop();
			await iterPromise;
			expect(changes).toHaveLength(0);
		});

		it("queues changes when no iterator is waiting", async () => {
			const field = new WatchedField("payments.fee", Number, { default: 0.01 });
			field._loadInitial("0.05");

			// Push changes before anyone iterates.
			const change1: Change = {
				fieldPath: "payments.fee",
				oldValue: "0.05",
				newValue: "0.10",
				version: 2,
				changedBy: "admin",
			};
			field._update("0.10", change1);

			const change2: Change = {
				fieldPath: "payments.fee",
				oldValue: "0.10",
				newValue: "0.20",
				version: 3,
				changedBy: "admin",
			};
			field._update("0.20", change2);

			// Now iterate -- should get the queued changes.
			const changes: Change[] = [];
			const iterPromise = (async () => {
				for await (const change of field) {
					changes.push(change);
					if (changes.length === 2) break;
				}
			})();

			await iterPromise;
			expect(changes).toHaveLength(2);
		});
	});
});

describe("ConfigWatcher", () => {
	let configStub: Record<string, MockInstance>;
	let metadata: Metadata;
	let mockStream: ReturnType<typeof createMockStream>;

	beforeEach(async () => {
		const configMod = await import("../src/generated/centralconfig/v1/config_service.js");

		mockStream = createMockStream();

		configStub = {
			getConfig: vi.fn(),
			subscribe: vi.fn().mockReturnValue(mockStream),
			close: vi.fn(),
		};

		(configMod.ConfigServiceClient as unknown as MockInstance).mockReturnValue(configStub);

		metadata = new Metadata();
		metadata.set("x-subject", "testuser");
		metadata.set("x-role", "superadmin");
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function createWatcher(): ConfigWatcher {
		return new ConfigWatcher(configStub as never, metadata, 10_000, "tenant-1");
	}

	function mockGetConfigSuccess(values: Array<{ fieldPath: string; value: unknown }>): void {
		configStub.getConfig.mockImplementation(
			(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
				cb(null, {
					config: {
						tenantId: "tenant-1",
						version: 1,
						values: values.map((v) => ({
							fieldPath: v.fieldPath,
							value: v.value,
							checksum: "abc",
						})),
					},
				});
			},
		);
	}

	describe("field()", () => {
		it("registers a field and returns a WatchedField", () => {
			const watcher = createWatcher();
			const field = watcher.field("payments.fee", Number, { default: 0.01 });
			expect(field).toBeInstanceOf(WatchedField);
			expect(field.value).toBe(0.01);
		});

		it("throws after start()", async () => {
			const watcher = createWatcher();
			mockGetConfigSuccess([]);
			watcher.field("payments.fee", Number, { default: 0.01 });

			await watcher.start();

			expect(() => watcher.field("other.field", String, { default: "" })).toThrow(
				"cannot register fields after start()",
			);

			await watcher.stop();
		});
	});

	describe("start()", () => {
		it("loads initial snapshot into registered fields", async () => {
			const watcher = createWatcher();
			const fee = watcher.field("payments.fee", Number, { default: 0.01 });
			const enabled = watcher.field("payments.enabled", Boolean, { default: false });

			mockGetConfigSuccess([
				{ fieldPath: "payments.fee", value: { numberValue: 0.05 } },
				{ fieldPath: "payments.enabled", value: { boolValue: true } },
			]);

			await watcher.start();

			expect(fee.value).toBe(0.05);
			expect(enabled.value).toBe(true);
			expect(configStub.subscribe).toHaveBeenCalledOnce();

			await watcher.stop();
		});

		it("uses default for missing fields in snapshot", async () => {
			const watcher = createWatcher();
			const fee = watcher.field("payments.fee", Number, { default: 0.01 });

			mockGetConfigSuccess([]);

			await watcher.start();

			expect(fee.value).toBe(0.01);

			await watcher.stop();
		});

		it("throws on double start", async () => {
			const watcher = createWatcher();
			mockGetConfigSuccess([]);

			await watcher.start();
			await expect(watcher.start()).rejects.toThrow("watcher already started");

			await watcher.stop();
		});

		it("subscribes with registered field paths", async () => {
			const watcher = createWatcher();
			watcher.field("payments.fee", Number, { default: 0.01 });
			watcher.field("payments.enabled", Boolean, { default: false });

			mockGetConfigSuccess([]);

			await watcher.start();

			expect(configStub.subscribe).toHaveBeenCalledOnce();
			const callArgs = configStub.subscribe.mock.calls[0];
			expect(callArgs?.[0]).toMatchObject({
				tenantId: "tenant-1",
				fieldPaths: ["payments.fee", "payments.enabled"],
			});

			await watcher.stop();
		});
	});

	describe("stop()", () => {
		it("cancels the stream", async () => {
			const watcher = createWatcher();
			mockGetConfigSuccess([]);
			watcher.field("payments.fee", Number, { default: 0.01 });

			await watcher.start();
			await watcher.stop();

			expect(mockStream.cancel).toHaveBeenCalledOnce();
		});

		it("is safe to call multiple times", async () => {
			const watcher = createWatcher();
			mockGetConfigSuccess([]);
			watcher.field("payments.fee", Number, { default: 0.01 });

			await watcher.start();
			await watcher.stop();
			await watcher.stop(); // no error

			expect(mockStream.cancel).toHaveBeenCalledOnce();
		});

		it("signals field async iterators to end", async () => {
			const watcher = createWatcher();
			const fee = watcher.field("payments.fee", Number, { default: 0.01 });

			mockGetConfigSuccess([]);
			await watcher.start();

			const changes: Change[] = [];
			const iterPromise = (async () => {
				for await (const change of fee) {
					changes.push(change);
				}
			})();

			// Give iterator time to start waiting.
			await new Promise((r) => setTimeout(r, 10));

			await watcher.stop();
			await iterPromise;

			expect(changes).toHaveLength(0);
		});
	});

	describe("Symbol.dispose", () => {
		it("calls stop", async () => {
			const watcher = createWatcher();
			mockGetConfigSuccess([]);
			watcher.field("payments.fee", Number, { default: 0.01 });

			await watcher.start();
			watcher[Symbol.dispose]();

			// Give async stop() time to complete.
			await new Promise((r) => setTimeout(r, 10));

			expect(mockStream.cancel).toHaveBeenCalledOnce();
		});
	});

	describe("processing changes", () => {
		it("updates fields on data events", async () => {
			const watcher = createWatcher();
			const fee = watcher.field("payments.fee", Number, { default: 0.01 });

			mockGetConfigSuccess([{ fieldPath: "payments.fee", value: { numberValue: 0.05 } }]);

			const handler = vi.fn();
			fee.on("change", handler);

			await watcher.start();

			// Simulate a change from the stream.
			mockStream.emit("data", {
				change: {
					tenantId: "tenant-1",
					version: 2,
					fieldPath: "payments.fee",
					oldValue: { numberValue: 0.05 },
					newValue: { numberValue: 0.1 },
					changedBy: "admin",
					changedAt: new Date(),
				},
			});

			expect(fee.value).toBe(0.1);
			expect(handler).toHaveBeenCalledOnce();
			expect(handler).toHaveBeenCalledWith(0.05, 0.1);

			await watcher.stop();
		});

		it("ignores changes for unregistered fields", async () => {
			const watcher = createWatcher();
			const fee = watcher.field("payments.fee", Number, { default: 0.01 });

			mockGetConfigSuccess([]);

			const handler = vi.fn();
			fee.on("change", handler);

			await watcher.start();

			// Emit a change for an unregistered field.
			mockStream.emit("data", {
				change: {
					tenantId: "tenant-1",
					version: 2,
					fieldPath: "other.field",
					oldValue: { stringValue: "old" },
					newValue: { stringValue: "new" },
					changedBy: "admin",
					changedAt: new Date(),
				},
			});

			expect(handler).not.toHaveBeenCalled();

			await watcher.stop();
		});

		it("ignores responses without a change", async () => {
			const watcher = createWatcher();
			const fee = watcher.field("payments.fee", Number, { default: 0.01 });

			mockGetConfigSuccess([]);

			const handler = vi.fn();
			fee.on("change", handler);

			await watcher.start();

			mockStream.emit("data", { change: undefined });

			expect(handler).not.toHaveBeenCalled();

			await watcher.stop();
		});

		it("handles null newValue (field set to null)", async () => {
			const watcher = createWatcher();
			const fee = watcher.field("payments.fee", Number, { default: 0.01 });

			mockGetConfigSuccess([{ fieldPath: "payments.fee", value: { numberValue: 0.05 } }]);

			await watcher.start();

			mockStream.emit("data", {
				change: {
					tenantId: "tenant-1",
					version: 2,
					fieldPath: "payments.fee",
					oldValue: { numberValue: 0.05 },
					newValue: undefined,
					changedBy: "admin",
					changedAt: new Date(),
				},
			});

			// Should reset to default.
			expect(fee.value).toBe(0.01);

			await watcher.stop();
		});
	});

	describe("reconnection", () => {
		it("reconnects on UNAVAILABLE error", async () => {
			vi.useFakeTimers();

			const watcher = createWatcher();
			watcher.field("payments.fee", Number, { default: 0.01 });

			mockGetConfigSuccess([]);

			await watcher.start();

			expect(configStub.subscribe).toHaveBeenCalledTimes(1);

			// Create a new mock stream for the reconnection.
			const newStream = createMockStream();
			configStub.subscribe.mockReturnValue(newStream);

			// Simulate UNAVAILABLE error.
			mockStream.emit("error", makeServiceError(status.UNAVAILABLE, "server unavailable"));

			// Advance timers past the backoff.
			await vi.advanceTimersByTimeAsync(60_000);

			expect(configStub.subscribe).toHaveBeenCalledTimes(2);

			// Stop to clean up, using new stream.
			newStream.cancel = vi.fn();
			await watcher.stop();

			vi.useRealTimers();
		});

		it("reconnects on INTERNAL error", async () => {
			vi.useFakeTimers();

			const watcher = createWatcher();
			watcher.field("payments.fee", Number, { default: 0.01 });

			mockGetConfigSuccess([]);

			await watcher.start();

			const newStream = createMockStream();
			configStub.subscribe.mockReturnValue(newStream);

			mockStream.emit("error", makeServiceError(status.INTERNAL, "internal error"));

			await vi.advanceTimersByTimeAsync(60_000);

			expect(configStub.subscribe).toHaveBeenCalledTimes(2);

			newStream.cancel = vi.fn();
			await watcher.stop();

			vi.useRealTimers();
		});

		it("stops on non-retryable error", async () => {
			const watcher = createWatcher();
			const fee = watcher.field("payments.fee", Number, { default: 0.01 });

			mockGetConfigSuccess([]);

			await watcher.start();

			// Simulate a PERMISSION_DENIED error (non-retryable).
			mockStream.emit("error", makeServiceError(status.PERMISSION_DENIED, "access denied"));

			// Give async stop() time to run.
			await new Promise((r) => setTimeout(r, 10));

			// The stream should have been cancelled by stop().
			expect(mockStream.cancel).toHaveBeenCalled();

			// The watcher should be stopped -- no reconnect.
			expect(configStub.subscribe).toHaveBeenCalledTimes(1);
		});

		it("reconnects on stream end", async () => {
			vi.useFakeTimers();

			const watcher = createWatcher();
			watcher.field("payments.fee", Number, { default: 0.01 });

			mockGetConfigSuccess([]);

			await watcher.start();

			const newStream = createMockStream();
			configStub.subscribe.mockReturnValue(newStream);

			// Simulate server gracefully ending the stream.
			mockStream.emit("end");

			await vi.advanceTimersByTimeAsync(60_000);

			expect(configStub.subscribe).toHaveBeenCalledTimes(2);

			newStream.cancel = vi.fn();
			await watcher.stop();

			vi.useRealTimers();
		});
	});

	describe("stopped guards", () => {
		it("ignores stream error after stop", async () => {
			const watcher = createWatcher();
			watcher.field("payments.fee", Number, { default: 0.01 });
			mockGetConfigSuccess([]);

			await watcher.start();
			await watcher.stop();

			// Error after stop should not throw or reconnect.
			mockStream.emit("error", makeServiceError(status.UNAVAILABLE, "late error"));
		});

		it("ignores stream end after stop", async () => {
			const watcher = createWatcher();
			watcher.field("payments.fee", Number, { default: 0.01 });
			mockGetConfigSuccess([]);

			await watcher.start();
			await watcher.stop();

			// End after stop should not reconnect.
			mockStream.emit("end");
		});
	});

	describe("GetConfig errors", () => {
		it("throws on GetConfig failure", async () => {
			const watcher = createWatcher();
			watcher.field("payments.fee", Number, { default: 0.01 });

			configStub.getConfig.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(makeServiceError(status.UNAVAILABLE, "server down"));
				},
			);

			await expect(watcher.start()).rejects.toThrow(DecreeError);
		});
	});
});
