import { EventEmitter } from "node:events";
import { Metadata, type ServiceError, status } from "@grpc/grpc-js";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import * as convertModule from "../src/convert.js";
import { DecreeError, TypeMismatchError } from "../src/errors.js";
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

		it("drops oldest change when queue is full", () => {
			const field = new WatchedField("payments.fee", Number, { default: 0.01, queueSize: 2 });
			field._loadInitial("0.01");

			const makeChange = (from: string, to: string, v: number): Change => ({
				fieldPath: "payments.fee",
				oldValue: from,
				newValue: to,
				version: v,
				changedBy: "admin",
			});

			field._update("0.02", makeChange("0.01", "0.02", 2));
			field._update("0.03", makeChange("0.02", "0.03", 3));
			// Queue is now full (size 2): [v2, v3].
			expect(field.droppedChanges).toBe(0);

			field._update("0.04", makeChange("0.03", "0.04", 4));
			// v2 dropped; queue: [v3, v4].
			expect(field.droppedChanges).toBe(1);

			field._update("0.05", makeChange("0.04", "0.05", 5));
			// v3 dropped; queue: [v4, v5].
			expect(field.droppedChanges).toBe(2);
		});

		it("droppedChanges is zero when consumer keeps up", async () => {
			const field = new WatchedField("payments.fee", Number, { default: 0.01, queueSize: 4 });
			field._loadInitial("0.01");

			const changes: Change[] = [];
			const iterPromise = (async () => {
				for await (const change of field) {
					changes.push(change);
					if (changes.length === 3) break;
				}
			})();

			await new Promise((r) => setTimeout(r, 10));

			const makeChange = (from: string, to: string, v: number): Change => ({
				fieldPath: "payments.fee",
				oldValue: from,
				newValue: to,
				version: v,
				changedBy: "admin",
			});
			field._update("0.02", makeChange("0.01", "0.02", 2));
			field._update("0.03", makeChange("0.02", "0.03", 3));
			field._update("0.04", makeChange("0.03", "0.04", 4));

			await iterPromise;
			expect(changes).toHaveLength(3);
			expect(field.droppedChanges).toBe(0);
		});

		it("resolves immediately when stopped becomes true inside Promise constructor (race condition)", async () => {
			const field = new WatchedField("payments.fee", Number, { default: 0.01 });

			// Simulate the race: stopped becomes true BETWEEN the while-check at
			// line 139 and the `if (this.stopped)` guard at line 146 (inside the
			// Promise constructor).
			//
			// Mechanism: intercept the changeQueue's shift() so that when the
			// iterator calls shift() (finding no queued item), we simultaneously
			// set stopped=true via _stop(). Since shift() returns undefined the
			// iterator proceeds past the `if (queued)` guard at line 141 and enters
			// the Promise constructor. At line 146, `this.stopped` is now true, so
			// the branch resolves immediately with {done:true}.
			//
			// Note: _stop() also tries to call pendingResolve, but pendingResolve
			// is still null at this point (line 150 hasn't run yet), so the only
			// path that resolves the promise is lines 147-148.
			const queue = (field as unknown as { changeQueue: Change[] }).changeQueue;
			const originalShift = queue.shift.bind(queue);
			let intercepted = false;
			queue.shift = () => {
				if (!intercepted) {
					intercepted = true;
					field._stop();
				}
				return originalShift();
			};

			const changes: Change[] = [];
			const iterPromise = (async () => {
				for await (const change of field) {
					changes.push(change);
				}
			})();

			await iterPromise;
			expect(changes).toHaveLength(0);
		});
	});

	describe("conversionError handling", () => {
		it("falls back to default and emits conversionError when _loadInitial value is unconvertible", () => {
			const field = new WatchedField("payments.fee", Number, { default: 0.01 });

			const errors: Array<{ err: DecreeError; raw: string }> = [];
			field.on("conversionError", (err, raw) => errors.push({ err, raw }));

			field._loadInitial("not-a-number");

			expect(field.value).toBe(0.01);
			expect(errors).toHaveLength(1);
			expect(errors[0]?.err).toBeInstanceOf(TypeMismatchError);
			expect(errors[0]?.raw).toBe("not-a-number");
		});

		it("retains current value and emits conversionError when _update value is unconvertible (type-flip)", () => {
			const field = new WatchedField("payments.fee", Number, { default: 0.01 });
			field._loadInitial("0.05");
			expect(field.value).toBe(0.05);

			const errors: Array<{ err: DecreeError; raw: string }> = [];
			field.on("conversionError", (err, raw) => errors.push({ err, raw }));

			const changeHandler = vi.fn();
			field.on("change", changeHandler);

			const change: Change = {
				fieldPath: "payments.fee",
				oldValue: "0.05",
				newValue: "not-a-number",
				version: 2,
				changedBy: "admin",
			};
			field._update("not-a-number", change);

			// Value must be retained, not overwritten.
			expect(field.value).toBe(0.05);
			// No change event should fire.
			expect(changeHandler).not.toHaveBeenCalled();
			// conversionError must be emitted.
			expect(errors).toHaveLength(1);
			expect(errors[0]?.err).toBeInstanceOf(TypeMismatchError);
			expect(errors[0]?.raw).toBe("not-a-number");
		});

		it("does not fire change event after a failed conversion in _update", () => {
			const field = new WatchedField("feature.enabled", Boolean, { default: false });
			field._loadInitial("true");

			const changeHandler = vi.fn();
			field.on("change", changeHandler);

			const change: Change = {
				fieldPath: "feature.enabled",
				oldValue: "true",
				newValue: "maybe",
				version: 2,
				changedBy: "admin",
			};
			field._update("maybe", change);

			expect(field.value).toBe(true);
			expect(changeHandler).not.toHaveBeenCalled();
		});

		it("_loadInitial wraps non-DecreeError in TypeMismatchError", () => {
			// convertValue is mocked to throw a plain Error (not DecreeError)
			// This exercises the false branch of `err instanceof DecreeError`
			vi.spyOn(convertModule, "convertValue").mockImplementationOnce(() => {
				throw new Error("plain error from converter");
			});

			const field = new WatchedField("f", Number, { default: 0 });
			const errors: Array<{ err: DecreeError; raw: string }> = [];
			field.on("conversionError", (err, raw) => errors.push({ err, raw }));

			field._loadInitial("some-value");

			expect(field.value).toBe(0); // default retained
			expect(errors).toHaveLength(1);
			expect(errors[0]?.err).toBeInstanceOf(TypeMismatchError);
			expect(errors[0]?.err.message).toBe("plain error from converter");
		});

		it("_update wraps non-DecreeError in TypeMismatchError", () => {
			const field = new WatchedField("f", Number, { default: 0 });
			field._loadInitial("1"); // valid initial

			vi.spyOn(convertModule, "convertValue").mockImplementationOnce(() => {
				throw new Error("plain conversion error");
			});

			const errors: Array<{ err: DecreeError; raw: string }> = [];
			field.on("conversionError", (err, raw) => errors.push({ err, raw }));
			const changeHandler = vi.fn();
			field.on("change", changeHandler);

			const change: Change = {
				fieldPath: "f",
				oldValue: "1",
				newValue: "bad",
				version: 2,
				changedBy: "admin",
			};
			field._update("bad", change);

			expect(field.value).toBe(1); // value retained
			expect(changeHandler).not.toHaveBeenCalled();
			expect(errors).toHaveLength(1);
			expect(errors[0]?.err).toBeInstanceOf(TypeMismatchError);
			expect(errors[0]?.err.message).toBe("plain conversion error");
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
				"cannot register fields after start(); use addField() instead",
			);

			await watcher.stop();
		});
	});

	describe("addField()", () => {
		it("works before start — returns WatchedField at default value", async () => {
			const watcher = createWatcher();
			const field = await watcher.addField("payments.fee", Number, { default: 0.01 });
			expect(field).toBeInstanceOf(WatchedField);
			expect(field.value).toBe(0.01);
		});

		it("before start — field is included when start() runs", async () => {
			const watcher = createWatcher();
			const fee = await watcher.addField("payments.fee", Number, { default: 0.01 });

			mockGetConfigSuccess([{ fieldPath: "payments.fee", value: { numberValue: 0.99 } }]);
			await watcher.start();

			expect(fee.value).toBe(0.99);
			await watcher.stop();
		});

		it("after start — loads initial value and re-subscribes", async () => {
			const watcher = createWatcher();
			watcher.field("payments.fee", Number, { default: 0.01 });
			mockGetConfigSuccess([{ fieldPath: "payments.fee", value: { numberValue: 0.05 } }]);
			await watcher.start();

			// New mock stream for the re-subscribe triggered by addField.
			const newStream = createMockStream();
			configStub.subscribe.mockReturnValue(newStream);
			configStub.getConfig.mockImplementationOnce(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, {
						config: {
							tenantId: "tenant-1",
							version: 2,
							values: [
								{ fieldPath: "payments.label", value: { stringValue: "hello" }, checksum: "x" },
							],
						},
					});
				},
			);

			const label = await watcher.addField("payments.label", String, { default: "" });

			expect(label.value).toBe("hello");
			// Original stream cancelled, new one opened.
			expect(mockStream.cancel).toHaveBeenCalledOnce();
			expect(configStub.subscribe).toHaveBeenCalledTimes(2);

			newStream.cancel = vi.fn();
			await watcher.stop();
		});

		it("after start — new subscribe call includes added field path", async () => {
			const watcher = createWatcher();
			watcher.field("payments.fee", Number, { default: 0.01 });
			mockGetConfigSuccess([]);
			await watcher.start();

			const newStream = createMockStream();
			configStub.subscribe.mockReturnValue(newStream);
			configStub.getConfig.mockImplementationOnce(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { config: { tenantId: "tenant-1", version: 2, values: [] } });
				},
			);

			await watcher.addField("payments.label", String, { default: "" });

			const subscribeArgs = configStub.subscribe.mock.calls[1];
			expect(subscribeArgs?.[0]).toMatchObject({
				tenantId: "tenant-1",
				fieldPaths: expect.arrayContaining(["payments.fee", "payments.label"]),
			});

			newStream.cancel = vi.fn();
			await watcher.stop();
		});

		it("cancels pending reconnect timer when addField() is called during backoff", async () => {
			vi.useFakeTimers();

			const watcher = createWatcher();
			watcher.field("payments.fee", Number, { default: 0.01 });
			mockGetConfigSuccess([]);
			await watcher.start();

			// Trigger a retryable error → schedules reconnect timer
			mockStream.emit("error", makeServiceError(status.UNAVAILABLE, "temp down"));

			// Set up mocks for the re-subscribe triggered by addField()
			const newStream = createMockStream();
			configStub.subscribe.mockReturnValue(newStream);
			configStub.getConfig.mockImplementationOnce(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { config: { tenantId: "tenant-1", version: 2, values: [] } });
				},
			);

			// addField() while reconnect timer is pending → clears the timer (lines 444-445)
			// and immediately re-subscribes
			const label = await watcher.addField("payments.label", String, { default: "" });
			expect(label).toBeInstanceOf(WatchedField);

			// The reconnect timer was cleared; addField triggered a fresh subscribe instead
			// Advance past the max backoff — no extra subscribe from the timer
			await vi.advanceTimersByTimeAsync(60_000);

			// 1 from start + 1 from addField = 2 (no extra from the reconnect timer)
			expect(configStub.subscribe).toHaveBeenCalledTimes(2);

			newStream.cancel = vi.fn();
			await watcher.stop();
			vi.useRealTimers();
		});

		it("after start — added field receives live changes", async () => {
			const watcher = createWatcher();
			watcher.field("payments.fee", Number, { default: 0.01 });
			mockGetConfigSuccess([]);
			await watcher.start();

			const newStream = createMockStream();
			configStub.subscribe.mockReturnValue(newStream);
			configStub.getConfig.mockImplementationOnce(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { config: { tenantId: "tenant-1", version: 2, values: [] } });
				},
			);

			const label = await watcher.addField("payments.label", String, { default: "" });

			newStream.emit("data", {
				change: {
					tenantId: "tenant-1",
					version: 3,
					fieldPath: "payments.label",
					oldValue: { stringValue: "" },
					newValue: { stringValue: "updated" },
					changedBy: "admin",
					changedAt: new Date(),
				},
			});

			expect(label.value).toBe("updated");

			newStream.cancel = vi.fn();
			await watcher.stop();
		});

		it("throws after stop()", async () => {
			const watcher = createWatcher();
			mockGetConfigSuccess([]);
			await watcher.start();
			await watcher.stop();

			await expect(watcher.addField("payments.fee", Number, { default: 0.01 })).rejects.toThrow(
				"cannot add fields after stop()",
			);
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

		it("handles GetConfig response with undefined config (loadSnapshotForFields false branch)", async () => {
			const watcher = createWatcher();
			const fee = watcher.field("payments.fee", Number, { default: 0.01 });

			// Return response with config: undefined
			configStub.getConfig.mockImplementation(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { config: undefined });
				},
			);

			await watcher.start();

			// Field should use default since no config was returned
			expect(fee.value).toBe(0.01);

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

		it("clears a pending reconnect timer when stopped during backoff", async () => {
			vi.useFakeTimers();

			const watcher = createWatcher();
			watcher.field("payments.fee", Number, { default: 0.01 });
			mockGetConfigSuccess([]);
			await watcher.start();

			// Trigger a retryable error → schedules a reconnect timer
			mockStream.emit("error", makeServiceError(status.UNAVAILABLE, "temp down"));

			// stop() before the timer fires → must clear the timer (lines 494-495)
			await watcher.stop();

			// Advance past the max backoff — if the timer wasn't cleared, subscribe
			// would be called again
			await vi.advanceTimersByTimeAsync(60_000);

			// Only 1 subscribe call (from start), no reconnect
			expect(configStub.subscribe).toHaveBeenCalledTimes(1);

			vi.useRealTimers();
		});

		it("stop() is safe to call before start() (stream is null)", async () => {
			const watcher = createWatcher();
			// Never called start(), so this.stream === null
			await watcher.stop();
			// No error, stream.cancel() not called (stream was null)
			expect(mockStream.cancel).not.toHaveBeenCalled();
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

	describe("Symbol.asyncDispose", () => {
		it("awaits stop() before resolving", async () => {
			const watcher = createWatcher();
			mockGetConfigSuccess([]);
			watcher.field("payments.fee", Number, { default: 0.01 });

			await watcher.start();
			await watcher[Symbol.asyncDispose]();

			expect(mockStream.cancel).toHaveBeenCalledOnce();
		});

		it("works with await using", async () => {
			const watcher = createWatcher();
			mockGetConfigSuccess([]);
			watcher.field("payments.fee", Number, { default: 0.01 });
			await watcher.start();

			// biome-ignore lint/suspicious/useAwait: await using satisfies the await requirement but biome doesn't recognise it yet
			await (async () => {
				await using w = watcher;
				void w;
			})();

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

		it("does not crash the stream when convertValue throws (type-flip mid-stream)", async () => {
			const watcher = createWatcher();
			const fee = watcher.field("payments.fee", Number, { default: 0.01 });

			mockGetConfigSuccess([{ fieldPath: "payments.fee", value: { numberValue: 0.05 } }]);

			const conversionErrors: Array<DecreeError> = [];
			fee.on("conversionError", (err) => conversionErrors.push(err));

			await watcher.start();

			// Simulate server flipping the field type to a non-numeric string.
			mockStream.emit("data", {
				change: {
					tenantId: "tenant-1",
					version: 2,
					fieldPath: "payments.fee",
					oldValue: { numberValue: 0.05 },
					newValue: { stringValue: "not-a-number" },
					changedBy: "admin",
					changedAt: new Date(),
				},
			});

			// Value must remain at last good value (0.05).
			expect(fee.value).toBe(0.05);
			// conversionError must have been emitted.
			expect(conversionErrors).toHaveLength(1);
			expect(conversionErrors[0]).toBeInstanceOf(TypeMismatchError);

			// Stream must still be alive — subsequent valid update must apply.
			mockStream.emit("data", {
				change: {
					tenantId: "tenant-1",
					version: 3,
					fieldPath: "payments.fee",
					oldValue: { numberValue: 0.05 },
					newValue: { numberValue: 0.99 },
					changedBy: "admin",
					changedAt: new Date(),
				},
			});

			expect(fee.value).toBe(0.99);

			await watcher.stop();
		});

		it("handles change with undefined oldValue (new field with no prior value)", async () => {
			const watcher = createWatcher();
			const fee = watcher.field("payments.fee", Number, { default: 0.01 });

			mockGetConfigSuccess([]);
			await watcher.start();

			const handler = vi.fn();
			fee.on("change", handler);

			// Emit change with oldValue: undefined (brand-new field)
			mockStream.emit("data", {
				change: {
					tenantId: "tenant-1",
					version: 2,
					fieldPath: "payments.fee",
					oldValue: undefined, // <- triggers FALSE branch at line 634
					newValue: { numberValue: 0.5 },
					changedBy: "admin",
					changedAt: new Date(),
				},
			});

			expect(fee.value).toBe(0.5);
			expect(handler).toHaveBeenCalledWith(0.01, 0.5); // oldValue is default since no prior

			await watcher.stop();
		});

		it("continues processing other fields after one field has a conversion error", async () => {
			const watcher = createWatcher();
			const fee = watcher.field("payments.fee", Number, { default: 0.01 });
			const label = watcher.field("payments.label", String, { default: "default" });

			mockGetConfigSuccess([
				{ fieldPath: "payments.fee", value: { numberValue: 0.05 } },
				{ fieldPath: "payments.label", value: { stringValue: "original" } },
			]);

			await watcher.start();

			// Bad update for fee (type-flip).
			mockStream.emit("data", {
				change: {
					tenantId: "tenant-1",
					version: 2,
					fieldPath: "payments.fee",
					oldValue: { numberValue: 0.05 },
					newValue: { stringValue: "bad" },
					changedBy: "admin",
					changedAt: new Date(),
				},
			});

			// Good update for label — must still apply.
			mockStream.emit("data", {
				change: {
					tenantId: "tenant-1",
					version: 3,
					fieldPath: "payments.label",
					oldValue: { stringValue: "original" },
					newValue: { stringValue: "updated" },
					changedBy: "admin",
					changedAt: new Date(),
				},
			});

			expect(fee.value).toBe(0.05); // unchanged due to conversion error
			expect(label.value).toBe("updated"); // updated successfully

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
			const _fee = watcher.field("payments.fee", Number, { default: 0.01 });

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

		it("emits subscriptionError for retryable errors", async () => {
			vi.useFakeTimers();

			const watcher = createWatcher();
			watcher.field("payments.fee", Number, { default: 0.01 });
			mockGetConfigSuccess([]);

			const errors: Error[] = [];
			watcher.on("subscriptionError", (err) => errors.push(err));

			await watcher.start();

			const newStream = createMockStream();
			configStub.subscribe.mockReturnValue(newStream);

			mockStream.emit("error", makeServiceError(status.UNAVAILABLE, "server unavailable"));

			expect(errors).toHaveLength(1);
			expect(errors[0]?.message).toBe("server unavailable");

			await vi.advanceTimersByTimeAsync(60_000);

			newStream.cancel = vi.fn();
			await watcher.stop();
			vi.useRealTimers();
		});

		it("emits subscriptionError for non-retryable errors", async () => {
			const watcher = createWatcher();
			watcher.field("payments.fee", Number, { default: 0.01 });
			mockGetConfigSuccess([]);

			const errors: Error[] = [];
			watcher.on("subscriptionError", (err) => errors.push(err));

			await watcher.start();

			mockStream.emit("error", makeServiceError(status.PERMISSION_DENIED, "access denied"));

			await new Promise((r) => setTimeout(r, 10));

			expect(errors).toHaveLength(1);
			expect(errors[0]?.message).toBe("access denied");
		});

		it("once listener fires only for the first subscriptionError", async () => {
			vi.useFakeTimers();

			const watcher = createWatcher();
			watcher.field("payments.fee", Number, { default: 0.01 });
			mockGetConfigSuccess([]);

			const errors: Error[] = [];
			watcher.once("subscriptionError", (err) => errors.push(err));

			await watcher.start();

			const newStream = createMockStream();
			configStub.subscribe.mockReturnValue(newStream);
			configStub.getConfig.mockImplementationOnce(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { config: { tenantId: "tenant-1", version: 2, values: [] } });
				},
			);

			// First error fires the once listener.
			mockStream.emit("error", makeServiceError(status.UNAVAILABLE, "first error"));
			await vi.advanceTimersByTimeAsync(60_000);

			// Second error on the new stream should NOT fire the once listener again.
			const newStream2 = createMockStream();
			configStub.subscribe.mockReturnValue(newStream2);
			configStub.getConfig.mockImplementationOnce(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { config: { tenantId: "tenant-1", version: 2, values: [] } });
				},
			);
			newStream.emit("error", makeServiceError(status.UNAVAILABLE, "second error"));
			await vi.advanceTimersByTimeAsync(60_000);

			expect(errors).toHaveLength(1);
			expect(errors[0]?.message).toBe("first error");

			newStream2.cancel = vi.fn();
			await watcher.stop();
			vi.useRealTimers();
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

		it("reloads snapshot on reconnect and applies updated values", async () => {
			vi.useFakeTimers();

			const watcher = createWatcher();
			const fee = watcher.field("payments.fee", Number, { default: 0.01 });

			// Initial snapshot: fee = 0.05
			mockGetConfigSuccess([{ fieldPath: "payments.fee", value: { numberValue: 0.05 } }]);
			await watcher.start();
			expect(fee.value).toBe(0.05);

			// On reconnect, snapshot returns fee = 0.99 (updated while disconnected)
			const newStream = createMockStream();
			configStub.subscribe.mockReturnValue(newStream);
			configStub.getConfig.mockImplementationOnce(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, {
						config: {
							tenantId: "tenant-1",
							version: 2,
							values: [
								{ fieldPath: "payments.fee", value: { numberValue: 0.99 }, checksum: "xyz" },
							],
						},
					});
				},
			);

			mockStream.emit("error", makeServiceError(status.UNAVAILABLE, "server unavailable"));
			await vi.advanceTimersByTimeAsync(60_000);

			// loadSnapshot called again (total 2 getConfig calls)
			expect(configStub.getConfig).toHaveBeenCalledTimes(2);
			// Value reflects the reconnect snapshot
			expect(fee.value).toBe(0.99);

			newStream.cancel = vi.fn();
			await watcher.stop();
			vi.useRealTimers();
		});

		it("applies stream updates after reconnect snapshot", async () => {
			vi.useFakeTimers();

			const watcher = createWatcher();
			const fee = watcher.field("payments.fee", Number, { default: 0.01 });

			mockGetConfigSuccess([{ fieldPath: "payments.fee", value: { numberValue: 0.05 } }]);
			await watcher.start();

			const newStream = createMockStream();
			configStub.subscribe.mockReturnValue(newStream);
			// Reconnect snapshot returns same value
			configStub.getConfig.mockImplementationOnce(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, {
						config: {
							tenantId: "tenant-1",
							version: 2,
							values: [
								{ fieldPath: "payments.fee", value: { numberValue: 0.05 }, checksum: "xyz" },
							],
						},
					});
				},
			);

			mockStream.emit("end");
			await vi.advanceTimersByTimeAsync(60_000);

			// Now emit a live update on the new stream
			newStream.emit("data", {
				change: {
					tenantId: "tenant-1",
					version: 3,
					fieldPath: "payments.fee",
					oldValue: { numberValue: 0.05 },
					newValue: { numberValue: 0.77 },
					changedBy: "admin",
					changedAt: new Date(),
				},
			});

			expect(fee.value).toBe(0.77);

			newStream.cancel = vi.fn();
			await watcher.stop();
			vi.useRealTimers();
		});

		it("retries with backoff when snapshot fails during reconnect", async () => {
			vi.useFakeTimers();

			const watcher = createWatcher();
			watcher.field("payments.fee", Number, { default: 0.01 });

			mockGetConfigSuccess([]);
			await watcher.start();

			const newStream = createMockStream();
			configStub.subscribe.mockReturnValue(newStream);

			// First reconnect snapshot fails
			configStub.getConfig.mockImplementationOnce(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(makeServiceError(status.UNAVAILABLE, "snapshot failed"));
				},
			);
			// Second reconnect snapshot succeeds
			configStub.getConfig.mockImplementationOnce(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, {
						config: { tenantId: "tenant-1", version: 2, values: [] },
					});
				},
			);

			mockStream.emit("error", makeServiceError(status.UNAVAILABLE, "server unavailable"));
			// First reconnect attempt fires, snapshot fails, schedules another
			await vi.advanceTimersByTimeAsync(60_000);
			// Second reconnect attempt fires, snapshot succeeds
			await vi.advanceTimersByTimeAsync(60_000);

			// subscribe called twice (start + successful reconnect)
			expect(configStub.subscribe).toHaveBeenCalledTimes(2);

			newStream.cancel = vi.fn();
			await watcher.stop();
			vi.useRealTimers();
		});

		it("resets backoff after first successful data event", async () => {
			vi.useFakeTimers();

			const watcher = createWatcher();
			watcher.field("payments.fee", Number, { default: 0.01 });

			mockGetConfigSuccess([]);
			await watcher.start();

			// Receive data — backoff should reset
			mockStream.emit("data", {
				change: {
					tenantId: "tenant-1",
					version: 2,
					fieldPath: "payments.fee",
					oldValue: { numberValue: 0.01 },
					newValue: { numberValue: 0.02 },
					changedBy: "admin",
					changedAt: new Date(),
				},
			});

			const newStream = createMockStream();
			configStub.subscribe.mockReturnValue(newStream);
			configStub.getConfig.mockImplementationOnce(
				(_req: unknown, _meta: unknown, _opts: unknown, cb: (...args: unknown[]) => void) => {
					cb(null, { config: { tenantId: "tenant-1", version: 2, values: [] } });
				},
			);

			mockStream.emit("error", makeServiceError(status.UNAVAILABLE, "disconnect"));

			// INITIAL_RECONNECT_BACKOFF is 500ms; advance just past it
			await vi.advanceTimersByTimeAsync(2_000);

			// subscribe called a second time, confirming backoff was short (reset to initial)
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

		it("scheduleReconnect() is a no-op when stop() is called inside subscriptionError listener (line 596)", async () => {
			const watcher = createWatcher();
			watcher.field("payments.fee", Number, { default: 0.01 });
			mockGetConfigSuccess([]);

			// stop() called synchronously from within the subscriptionError handler.
			// This makes this.stopped true by the time scheduleReconnect() checks it,
			// even though the error handler itself passed the `if (this.stopped)` guard
			// at the top.
			watcher.on("subscriptionError", () => {
				void watcher.stop();
			});

			await watcher.start();

			// Trigger retryable error → subscriptionError fires → stop() called →
			// scheduleReconnect checks stopped (true) → returns early at line 596
			mockStream.emit("error", makeServiceError(status.UNAVAILABLE, "down"));

			await new Promise((r) => setTimeout(r, 10));

			// No reconnect should have been scheduled
			expect(configStub.subscribe).toHaveBeenCalledTimes(1);
		});

		it("subscribe() is a no-op when watcher is already stopped (line 553)", () => {
			// Directly exercise the subscribe() guard by calling it on a stopped watcher
			// via the private method cast. This covers the branch that is otherwise only
			// reachable through a race between reloadAndSubscribe and stop().
			const watcher = createWatcher();
			(watcher as unknown as { stopped: boolean }).stopped = true;
			(watcher as unknown as { subscribe: () => void }).subscribe();
			// subscribe() must have returned early — no getConfig or gRPC subscribe calls
			expect(configStub.getConfig).not.toHaveBeenCalled();
			expect(configStub.subscribe).not.toHaveBeenCalled();
		});

		it("reloadAndSubscribe() exits early when watcher is already stopped (line 611)", async () => {
			// Directly exercise the reloadAndSubscribe() guard by calling it on a stopped
			// watcher. This covers the branch that is otherwise only reachable when
			// stop() races with the reconnect timer firing.
			const watcher = createWatcher();
			(watcher as unknown as { stopped: boolean }).stopped = true;
			await (
				watcher as unknown as { reloadAndSubscribe: (backoff: number) => Promise<void> }
			).reloadAndSubscribe(500);
			// Should have returned early — no getConfig or gRPC subscribe calls
			expect(configStub.getConfig).not.toHaveBeenCalled();
			expect(configStub.subscribe).not.toHaveBeenCalled();
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
