/**
 * Integration tests against a real decree server (docker-compose fixture).
 *
 * Gated on DECREE_INTEGRATION=1. Covers: snapshot, watch, reconnect,
 * set with checksum, and set with abort.
 *
 * Run: DECREE_INTEGRATION=1 npm run test:integration
 */

import { credentials, Metadata } from "@grpc/grpc-js";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { ConfigClient } from "../src/client.js";
import { CancelledError, ChecksumMismatchError } from "../src/errors.js";
import { ConfigServiceClient } from "../src/generated/centralconfig/v1/config_service.js";

const tenantId = inject("tenantId");
const serverAddr = inject("serverAddr");

let client: ConfigClient;
let rawConfig: InstanceType<typeof ConfigServiceClient>;

const meta = new Metadata();
meta.set("x-subject", "integration-test");
meta.set("x-role", "superadmin");

beforeAll(() => {
	client = new ConfigClient(serverAddr, {
		insecure: true,
		subject: "integration-test",
		role: "superadmin",
		retry: false,
	});
	rawConfig = new ConfigServiceClient(serverAddr, credentials.createInsecure());
});

afterAll(() => {
	client.close();
	rawConfig.close();
});

// ---------------------------------------------------------------------------
// Snapshot — getAll() round-trip
// ---------------------------------------------------------------------------

describe("snapshot", () => {
	it("getAll() returns all values set during setup", async () => {
		const all = await client.getAll(tenantId);

		expect(all["app.fee"]).toBe("0.5%");
		expect(all["app.count"]).toBe("42");
		expect(all["app.enabled"]).toBe("true");
	});

	it("get() decodes individual typed values", async () => {
		const fee = await client.get(tenantId, "app.fee", String);
		const count = await client.get(tenantId, "app.count", Number);
		const enabled = await client.get(tenantId, "app.enabled", Boolean);

		expect(fee).toBe("0.5%");
		expect(count).toBe(42);
		expect(enabled).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Watch — ConfigWatcher snapshot + live Subscribe change
// ---------------------------------------------------------------------------

describe("watch", () => {
	it("loads initial snapshot and receives a Subscribe change", async () => {
		await client.set(tenantId, "app.fee", "1.0%");

		const watcher = client.watch(tenantId);
		const fee = watcher.field("app.fee", String, { default: "" });
		await watcher.start();

		expect(fee.value).toBe("1.0%");

		const changeArrived = new Promise<void>((resolve) => {
			fee.on("change", () => resolve());
		});

		await client.set(tenantId, "app.fee", "2.0%");
		await changeArrived;

		expect(fee.value).toBe("2.0%");

		await watcher.stop();

		// Reset for other tests.
		await client.set(tenantId, "app.fee", "0.5%");
	});
});

// ---------------------------------------------------------------------------
// Reconnect — stop and restart picks up changes made while stopped
// ---------------------------------------------------------------------------

describe("reconnect", () => {
	it("a restarted watcher loads the latest snapshot after changes", async () => {
		const watcher1 = client.watch(tenantId);
		const fee1 = watcher1.field("app.fee", String, { default: "" });
		await watcher1.start();
		expect(fee1.value).toBe("0.5%");
		await watcher1.stop();

		await client.set(tenantId, "app.fee", "3.0%");

		const watcher2 = client.watch(tenantId);
		const fee2 = watcher2.field("app.fee", String, { default: "" });
		await watcher2.start();

		expect(fee2.value).toBe("3.0%");

		await watcher2.stop();

		// Reset for other tests.
		await client.set(tenantId, "app.fee", "0.5%");
	});
});

// ---------------------------------------------------------------------------
// Set with checksum — optimistic concurrency control
// ---------------------------------------------------------------------------

describe("set with checksum", () => {
	it("set with correct checksum succeeds; stale checksum fails with ChecksumMismatchError", async () => {
		const fieldResp = await new Promise<{ value?: { checksum: string } }>((resolve, reject) => {
			rawConfig.getField(
				{ tenantId, fieldPath: "app.fee", includeDescription: false },
				meta,
				(err, res) => {
					if (err) reject(err);
					else resolve(res as { value?: { checksum: string } });
				},
			);
		});

		const checksum = fieldResp.value?.checksum;
		if (!checksum) throw new Error("getField returned no checksum");

		// Correct checksum → should succeed.
		await expect(
			client.set(tenantId, "app.fee", "0.6%", { expectedChecksum: checksum }),
		).resolves.toBeUndefined();

		// The checksum is now stale → should fail.
		await expect(
			client.set(tenantId, "app.fee", "0.7%", { expectedChecksum: checksum }),
		).rejects.toThrow(ChecksumMismatchError);

		// Reset for other tests.
		await client.set(tenantId, "app.fee", "0.5%");
	});
});

// ---------------------------------------------------------------------------
// Set with abort — AbortController cancels in-flight RPC
// ---------------------------------------------------------------------------

describe("set with abort", () => {
	it("AbortController aborts a set(); if cancelled, error is CancelledError", async () => {
		const ac = new AbortController();

		const setPromise = client.set(tenantId, "app.fee", "abort-test", {
			signal: ac.signal,
		});

		// Abort on the next microtask tick — races with the gRPC call.
		// If abort fires before completion, expect CancelledError.
		// If set completes first, the promise resolves and we just clean up.
		queueMicrotask(() => ac.abort());

		await setPromise.then(
			async () => {
				// Set completed before abort — verify value was written.
				const v = await client.get(tenantId, "app.fee", String);
				expect(v).toBe("abort-test");
			},
			(err: unknown) => {
				expect(err).toBeInstanceOf(CancelledError);
			},
		);

		// Reset for other tests regardless of outcome.
		await client.set(tenantId, "app.fee", "0.5%");
	});
});
