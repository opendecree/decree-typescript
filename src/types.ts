/**
 * Public data types returned by the OpenDecree SDK.
 *
 * All types are interfaces with readonly properties -- plain objects, zero runtime cost.
 */

import type { status as GrpcStatus } from "@grpc/grpc-js";

/** A single configuration value. */
export interface ConfigValue {
	readonly fieldPath: string;
	readonly value: string;
	readonly checksum: string;
	readonly description: string;
}

/** A configuration change event from a subscription. */
export interface Change {
	readonly fieldPath: string;
	readonly oldValue: string | null;
	readonly newValue: string | null;
	readonly version: number;
	readonly changedBy: string;
}

/** Server version information from the VersionService. */
export interface ServerVersion {
	readonly version: string;
	readonly commit: string;
}

/** Configuration for retry behavior. */
export interface RetryConfig {
	/** Maximum number of attempts (including the first). Default: 3. */
	readonly maxAttempts?: number;
	/** Initial backoff duration in milliseconds. Default: 100. */
	readonly initialBackoff?: number;
	/** Maximum backoff duration in milliseconds. Default: 5000. */
	readonly maxBackoff?: number;
	/** Backoff multiplier between attempts. Default: 2. */
	readonly multiplier?: number;
	/** gRPC status codes that trigger a retry. Default: [UNAVAILABLE, DEADLINE_EXCEEDED]. */
	readonly retryableCodes?: (typeof GrpcStatus)[keyof typeof GrpcStatus][];
}

/** Options for configuring a ConfigClient. */
export interface ClientOptions {
	/** Identity for x-subject metadata header. */
	readonly subject?: string;
	/** Role for x-role metadata header. Default: "superadmin". */
	readonly role?: string;
	/** Default tenant for x-tenant-id metadata header. */
	readonly tenantId?: string;
	/** Bearer token. When set, metadata headers are not sent. */
	readonly token?: string;
	/** Use plaintext (no TLS). Default: true. */
	readonly insecure?: boolean;
	/** Default per-RPC timeout in milliseconds. Default: 10000. */
	readonly timeout?: number;
	/** Retry configuration. Set to false to disable retry. Default: RetryConfig defaults. */
	readonly retry?: RetryConfig | false;
}
