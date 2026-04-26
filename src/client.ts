/**
 * ConfigClient -- the main entry point for the OpenDecree TypeScript SDK.
 *
 * Wraps callback-based gRPC stubs with a promise-based API.
 * Provides typed get() via function overloads with runtime converters.
 */

import { Metadata, type ServiceError } from "@grpc/grpc-js";
import { createChannel } from "./channel.js";
import { checkVersionCompatible } from "./compat.js";
import { type Converter, convertValue, typedValueToString } from "./convert.js";
import { mapGrpcError, NotFoundError } from "./errors.js";
import {
	type GetConfigRequest,
	type GetConfigResponse,
	type GetFieldRequest,
	type GetFieldResponse,
	ConfigServiceClient as GrpcConfigServiceClient,
	type SetFieldRequest,
	type SetFieldResponse,
	type SetFieldsRequest,
	type SetFieldsResponse,
} from "./generated/centralconfig/v1/config_service.js";
import {
	type GetServerInfoRequest,
	type GetServerInfoResponse,
	ServerServiceClient as GrpcServerServiceClient,
} from "./generated/centralconfig/v1/server_service.js";
import { withRetry } from "./retry.js";
import type { ClientOptions, RetryConfig, ServerInfo } from "./types.js";
import { ConfigWatcher } from "./watcher.js";

/**
 * Options for get() with nullable support.
 */
interface GetOptions {
	readonly nullable?: boolean;
}

/**
 * ConfigClient provides a promise-based API for reading and writing
 * OpenDecree configuration values.
 *
 * @example
 * ```ts
 * const client = new ConfigClient('localhost:9090', { subject: 'myapp' });
 * try {
 *   const fee = await client.get('tenant-id', 'payments.fee');
 *   const retries = await client.get('tenant-id', 'payments.retries', Number);
 * } finally {
 *   client.close();
 * }
 * ```
 */
export class ConfigClient {
	private readonly configStub: InstanceType<typeof GrpcConfigServiceClient>;
	private readonly serverStub: InstanceType<typeof GrpcServerServiceClient>;
	private readonly metadata: Metadata;
	private readonly timeout: number;
	private readonly retryConfig: RetryConfig | false;
	private serverInfoPromise: Promise<ServerInfo> | undefined;

	constructor(target: string, options?: ClientOptions) {
		const opts = options ?? {};
		this.timeout = opts.timeout ?? 10_000;
		this.retryConfig = opts.retry === false ? false : (opts.retry ?? {});

		// Build auth metadata.
		this.metadata = new Metadata();
		if (opts.token) {
			this.metadata.set("authorization", `Bearer ${opts.token}`);
		} else {
			if (opts.subject) {
				this.metadata.set("x-subject", opts.subject);
			}
			this.metadata.set("x-role", opts.role ?? "superadmin");
			if (opts.tenantId) {
				this.metadata.set("x-tenant-id", opts.tenantId);
			}
		}

		const creds = createChannel(opts);
		this.configStub = new GrpcConfigServiceClient(target, creds);
		this.serverStub = new GrpcServerServiceClient(target, creds);
	}

	/**
	 * The server's info (version, commit, features), fetched once and cached.
	 * Returns a promise that resolves to the ServerInfo.
	 */
	get serverInfo(): Promise<ServerInfo> {
		if (this.serverInfoPromise === undefined) {
			this.serverInfoPromise = this.fetchServerInfo();
		}
		return this.serverInfoPromise;
	}

	/**
	 * The server's version, fetched once and cached.
	 * @deprecated Use serverInfo instead.
	 */
	get serverVersion(): Promise<ServerInfo> {
		return this.serverInfo;
	}

	/**
	 * Check that the server version is compatible with this SDK.
	 * Fetches the server info (cached) and compares against SUPPORTED_SERVER_VERSION.
	 *
	 * @throws IncompatibleServerError if the server is outside the supported range.
	 * @throws UnavailableError if the server is unreachable.
	 */
	async checkCompatibility(): Promise<void> {
		const si = await this.serverInfo;
		checkVersionCompatible(si.version);
	}

	/**
	 * Get a config value as a string (default).
	 */
	get(tenantId: string, fieldPath: string): Promise<string>;
	/**
	 * Get a config value converted to the specified type.
	 */
	get(tenantId: string, fieldPath: string, type: typeof Number): Promise<number>;
	get(tenantId: string, fieldPath: string, type: typeof Boolean): Promise<boolean>;
	get(tenantId: string, fieldPath: string, type: typeof String): Promise<string>;
	/**
	 * Get a config value with nullable support.
	 * Returns null if the field has no value instead of throwing.
	 */
	get(
		tenantId: string,
		fieldPath: string,
		type: typeof Number,
		options: { nullable: true },
	): Promise<number | null>;
	get(
		tenantId: string,
		fieldPath: string,
		type: typeof Boolean,
		options: { nullable: true },
	): Promise<boolean | null>;
	get(
		tenantId: string,
		fieldPath: string,
		type: typeof String,
		options: { nullable: true },
	): Promise<string | null>;
	get(
		tenantId: string,
		fieldPath: string,
		type?: Converter,
		options?: GetOptions,
	): Promise<unknown> {
		const targetType = type ?? String;
		const nullable = options?.nullable ?? false;

		const fn = async () => {
			const resp = await this.callGetField({
				tenantId,
				fieldPath,
				includeDescription: false,
			});

			const cv = resp.value;
			if (cv === undefined || cv.value === undefined) {
				if (nullable) {
					return null;
				}
				throw new NotFoundError(`field ${fieldPath} has no value for tenant ${tenantId}`);
			}

			const raw = typedValueToString(cv.value);
			if (raw === "" && cv.value !== undefined) {
				// TypedValue was present but empty -- treat as the string value
				if (nullable) {
					return null;
				}
			}
			return convertValue(raw, targetType);
		};

		return this.withRetryAndMap(fn);
	}

	/**
	 * Get all config values for a tenant.
	 *
	 * @returns A record mapping field paths to their string values.
	 */
	async getAll(tenantId: string): Promise<Record<string, string>> {
		const fn = async () => {
			const resp = await this.callGetConfig({
				tenantId,
				includeDescriptions: false,
			});

			const result: Record<string, string> = {};
			if (resp.config) {
				for (const cv of resp.config.values) {
					result[cv.fieldPath] = typedValueToString(cv.value);
				}
			}
			return result;
		};

		return this.withRetryAndMap(fn);
	}

	/**
	 * Set a config value. The value is sent as a string -- the server
	 * coerces it to the schema-defined type.
	 */
	async set(tenantId: string, fieldPath: string, value: string): Promise<void> {
		const fn = async () => {
			await this.callSetField({
				tenantId,
				fieldPath,
				value: { stringValue: value },
			});
		};

		return this.withRetryAndMap(fn);
	}

	/**
	 * Atomically set multiple config values.
	 *
	 * @param values - Record mapping field paths to string values.
	 * @param options - Optional description for the audit log.
	 */
	async setMany(
		tenantId: string,
		values: Record<string, string>,
		options?: { description?: string },
	): Promise<void> {
		const fn = async () => {
			const updates = Object.entries(values).map(([fieldPath, v]) => ({
				fieldPath,
				value: { stringValue: v },
			}));
			await this.callSetFields({
				tenantId,
				updates,
				description: options?.description,
			});
		};

		return this.withRetryAndMap(fn);
	}

	/**
	 * Set a config field to null.
	 */
	async setNull(tenantId: string, fieldPath: string): Promise<void> {
		const fn = async () => {
			await this.callSetField({
				tenantId,
				fieldPath,
				value: undefined,
			});
		};

		return this.withRetryAndMap(fn);
	}

	/**
	 * Create a config watcher for a tenant.
	 *
	 * Returns a ConfigWatcher that can register fields and subscribe to
	 * live configuration changes. Call `field()` to register fields, then
	 * `start()` to load the initial snapshot and begin streaming.
	 *
	 * @param tenantId - The tenant ID to watch.
	 * @returns A new ConfigWatcher instance.
	 *
	 * @example
	 * ```ts
	 * const watcher = client.watch('tenant-id');
	 * const fee = watcher.field('payments.fee', Number, { default: 0.01 });
	 * await watcher.start();
	 * console.log(fee.value);
	 * ```
	 */
	watch(tenantId: string): ConfigWatcher {
		return new ConfigWatcher(this.configStub, this.metadata, this.timeout, tenantId);
	}

	/**
	 * Close the underlying gRPC channels.
	 */
	close(): void {
		this.configStub.close();
		this.serverStub.close();
	}

	/**
	 * Dispose pattern support (TypeScript 5.2+).
	 */
	[Symbol.dispose](): void {
		this.close();
	}

	// --- Private helpers ---

	private async fetchServerInfo(): Promise<ServerInfo> {
		const fn = () => this.callGetServerInfo({});
		const resp = await this.withRetryAndMap(fn);
		return { version: resp.version, commit: resp.commit, features: resp.features };
	}

	private async withRetryAndMap<T>(fn: () => Promise<T>): Promise<T> {
		try {
			return await withRetry(this.retryConfig, fn);
		} catch (err) {
			if (isServiceError(err)) {
				throw mapGrpcError(err);
			}
			throw err;
		}
	}

	private callGetField(request: GetFieldRequest): Promise<GetFieldResponse> {
		return new Promise((resolve, reject) => {
			this.configStub.getField(
				request,
				this.metadata,
				{ deadline: Date.now() + this.timeout },
				(err: ServiceError | null, resp: GetFieldResponse) => {
					if (err) reject(err);
					else resolve(resp);
				},
			);
		});
	}

	private callGetConfig(request: GetConfigRequest): Promise<GetConfigResponse> {
		return new Promise((resolve, reject) => {
			this.configStub.getConfig(
				request,
				this.metadata,
				{ deadline: Date.now() + this.timeout },
				(err: ServiceError | null, resp: GetConfigResponse) => {
					if (err) reject(err);
					else resolve(resp);
				},
			);
		});
	}

	private callSetField(request: SetFieldRequest): Promise<SetFieldResponse> {
		return new Promise((resolve, reject) => {
			this.configStub.setField(
				request,
				this.metadata,
				{ deadline: Date.now() + this.timeout },
				(err: ServiceError | null, resp: SetFieldResponse) => {
					if (err) reject(err);
					else resolve(resp);
				},
			);
		});
	}

	private callSetFields(request: SetFieldsRequest): Promise<SetFieldsResponse> {
		return new Promise((resolve, reject) => {
			this.configStub.setFields(
				request,
				this.metadata,
				{ deadline: Date.now() + this.timeout },
				(err: ServiceError | null, resp: SetFieldsResponse) => {
					if (err) reject(err);
					else resolve(resp);
				},
			);
		});
	}

	private callGetServerInfo(request: GetServerInfoRequest): Promise<GetServerInfoResponse> {
		return new Promise((resolve, reject) => {
			this.serverStub.getServerInfo(
				request,
				this.metadata,
				{ deadline: Date.now() + this.timeout },
				(err: ServiceError | null, resp: GetServerInfoResponse) => {
					if (err) reject(err);
					else resolve(resp);
				},
			);
		});
	}
}

function isServiceError(err: unknown): err is ServiceError {
	return err instanceof Error && typeof (err as ServiceError).code === "number";
}
