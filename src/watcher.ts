/**
 * ConfigWatcher and WatchedField -- live configuration subscriptions.
 *
 * ConfigWatcher manages a server-streaming Subscribe RPC, loads an initial
 * snapshot via GetConfig, and pushes changes to registered WatchedField instances.
 * WatchedField provides the current value, EventEmitter change notifications,
 * and async iteration via Symbol.asyncIterator.
 */

import { EventEmitter } from "node:events";
import { type ClientReadableStream, type Metadata, type ServiceError, status } from "@grpc/grpc-js";
import type { Converter } from "./convert.js";
import { convertValue, typedValueToString } from "./convert.js";
import { DecreeError, mapGrpcError } from "./errors.js";
import type {
	GetConfigRequest,
	GetConfigResponse,
	SubscribeRequest,
	SubscribeResponse,
} from "./generated/centralconfig/v1/config_service.js";
import type { ConfigServiceClient as GrpcConfigServiceClient } from "./generated/centralconfig/v1/config_service.js";
import type { Change } from "./types.js";

/** gRPC status codes that trigger automatic reconnection. */
const RETRYABLE_CODES = new Set([status.UNAVAILABLE, status.INTERNAL]);

/** Maximum reconnect backoff in milliseconds. */
const MAX_RECONNECT_BACKOFF = 30_000;

/** Initial reconnect backoff in milliseconds. */
const INITIAL_RECONNECT_BACKOFF = 500;

/** Backoff multiplier between reconnect attempts. */
const RECONNECT_MULTIPLIER = 2;

/**
 * Options for registering a watched field.
 */
interface FieldOptions<T> {
	/** Default value returned when the field has no value on the server. */
	readonly default: T;
}

/**
 * WatchedField provides live access to a single configuration value.
 *
 * The value is always available synchronously via the `.value` getter.
 * Changes can be observed via the EventEmitter `'change'` event or
 * by iterating with `for await...of`.
 *
 * @typeParam T - The converted type (string, number, or boolean).
 *
 * @example
 * ```ts
 * const fee = watcher.field('payments.fee', Number, { default: 0.01 });
 * await watcher.start();
 *
 * // Synchronous access
 * console.log(fee.value);
 *
 * // EventEmitter
 * fee.on('change', (oldVal, newVal) => {
 *   console.log(`Fee: ${oldVal} -> ${newVal}`);
 * });
 *
 * // Async iteration
 * for await (const change of fee) {
 *   console.log(change);
 * }
 * ```
 */
export class WatchedField<T> extends EventEmitter {
	private currentValue: T;
	private readonly defaultValue: T;
	private readonly converter: Converter;
	/** The dot-separated field path this WatchedField is bound to. */
	readonly path: string;
	private stopped = false;
	private pendingResolve: ((value: IteratorResult<Change>) => void) | null = null;
	private readonly changeQueue: Change[] = [];

	/** @internal */
	constructor(path: string, converter: Converter, options: FieldOptions<T>) {
		super();
		this.path = path;
		this.converter = converter;
		this.defaultValue = options.default;
		this.currentValue = options.default;
	}

	/**
	 * The current value of this field.
	 *
	 * Always returns the latest known value. Before `watcher.start()` completes,
	 * this returns the default value. After the initial snapshot loads, it reflects
	 * the server value. Subsequently it updates in real-time from the Subscribe stream.
	 *
	 * @returns The current value, converted to type T.
	 */
	get value(): T {
		return this.currentValue;
	}

	/**
	 * Async iterator that yields Change objects as they arrive.
	 *
	 * The iterator completes when the watcher is stopped.
	 *
	 * @example
	 * ```ts
	 * for await (const change of field) {
	 *   console.log(`${change.oldValue} -> ${change.newValue}`);
	 * }
	 * ```
	 */
	async *[Symbol.asyncIterator](): AsyncIterableIterator<Change> {
		while (!this.stopped) {
			const queued = this.changeQueue.shift();
			if (queued) {
				yield queued;
				continue;
			}
			const result = await new Promise<IteratorResult<Change>>((resolve) => {
				if (this.stopped) {
					resolve({ done: true, value: undefined });
					return;
				}
				this.pendingResolve = resolve;
			});
			if (result.done) {
				return;
			}
			yield result.value;
		}
	}

	/**
	 * Load the initial value from a GetConfig snapshot.
	 *
	 * @param rawValue - The raw string value from the snapshot, or null if absent.
	 * @internal
	 */
	_loadInitial(rawValue: string | null): void {
		if (rawValue === null) {
			this.currentValue = this.defaultValue;
		} else {
			this.currentValue = convertValue(rawValue, this.converter) as T;
		}
	}

	/**
	 * Update the field value from a ConfigChange event.
	 *
	 * Emits a `'change'` event if the new value differs from the current value.
	 * Enqueues a Change for async iteration.
	 *
	 * @param rawValue - The new raw string value, or null if set to null.
	 * @param change - The Change object describing this update.
	 * @internal
	 */
	_update(rawValue: string | null, change: Change): void {
		const oldValue = this.currentValue;
		if (rawValue === null) {
			this.currentValue = this.defaultValue;
		} else {
			this.currentValue = convertValue(rawValue, this.converter) as T;
		}

		// Only emit if the value actually changed.
		if (oldValue === this.currentValue) {
			return;
		}

		this.emit("change", oldValue, this.currentValue);

		if (this.pendingResolve) {
			const resolve = this.pendingResolve;
			this.pendingResolve = null;
			resolve({ done: false, value: change });
		} else {
			this.changeQueue.push(change);
		}
	}

	/**
	 * Signal that the watcher has stopped, ending async iteration.
	 *
	 * @internal
	 */
	_stop(): void {
		this.stopped = true;
		if (this.pendingResolve) {
			const resolve = this.pendingResolve;
			this.pendingResolve = null;
			resolve({ done: true, value: undefined });
		}
	}
}

/**
 * ConfigWatcher subscribes to live configuration changes for a tenant.
 *
 * Created via `client.watch(tenantId)`. Register fields with `field()` before
 * calling `start()`. The watcher loads an initial snapshot via GetConfig, then
 * opens a Subscribe stream for real-time updates. On transient errors
 * (UNAVAILABLE, INTERNAL), it automatically reconnects with exponential backoff.
 *
 * @example
 * ```ts
 * const client = new ConfigClient('localhost:9090', { subject: 'myapp' });
 * const watcher = client.watch('tenant-id');
 *
 * const fee = watcher.field('payments.fee', Number, { default: 0.01 });
 * const enabled = watcher.field('payments.enabled', Boolean, { default: false });
 *
 * await watcher.start();
 * console.log(fee.value); // current value from server
 *
 * fee.on('change', (oldVal, newVal) => {
 *   console.log(`Fee changed: ${oldVal} -> ${newVal}`);
 * });
 *
 * // Later:
 * await watcher.stop();
 * client.close();
 * ```
 */
export class ConfigWatcher {
	private readonly configStub: InstanceType<typeof GrpcConfigServiceClient>;
	private readonly metadata: Metadata;
	private readonly timeout: number;
	private readonly tenantId: string;
	private readonly fields = new Map<string, WatchedField<unknown>>();
	private started = false;
	private stopped = false;
	private stream: ClientReadableStream<SubscribeResponse> | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	/** @internal */
	constructor(
		configStub: InstanceType<typeof GrpcConfigServiceClient>,
		metadata: Metadata,
		timeout: number,
		tenantId: string,
	) {
		this.configStub = configStub;
		this.metadata = metadata;
		this.timeout = timeout;
		this.tenantId = tenantId;
	}

	/**
	 * Register a field to watch.
	 *
	 * Must be called before `start()`. Returns a WatchedField that will be
	 * populated with the initial value from the snapshot and updated in
	 * real-time from the Subscribe stream.
	 *
	 * @param path - Dot-separated field path (e.g. "payments.fee").
	 * @param converter - Type converter: String, Number, or Boolean.
	 * @param options - Options including the default value.
	 * @returns A WatchedField instance for this path.
	 * @throws DecreeError if called after start().
	 *
	 * @example
	 * ```ts
	 * const fee = watcher.field('payments.fee', Number, { default: 0.01 });
	 * ```
	 */
	field<T>(path: string, converter: Converter, options: FieldOptions<T>): WatchedField<T> {
		if (this.started) {
			throw new DecreeError("cannot register fields after start()");
		}
		const wf = new WatchedField<T>(path, converter, options);
		this.fields.set(path, wf as WatchedField<unknown>);
		return wf;
	}

	/**
	 * Load the initial snapshot and start the Subscribe stream.
	 *
	 * Fetches the current config via GetConfig, populates all registered fields,
	 * then opens a server-streaming Subscribe RPC. On transient errors, the
	 * stream automatically reconnects with exponential backoff.
	 *
	 * @throws DecreeError if called more than once.
	 * @throws DecreeError if the initial GetConfig call fails.
	 */
	async start(): Promise<void> {
		if (this.started) {
			throw new DecreeError("watcher already started");
		}
		this.started = true;
		this.stopped = false;

		// Load initial snapshot.
		await this.loadSnapshot();

		// Start the subscribe stream.
		this.subscribe();
	}

	/**
	 * Stop the watcher, cancelling the Subscribe stream and cleaning up.
	 *
	 * Safe to call multiple times. After stopping, registered WatchedField
	 * async iterators will complete.
	 */
	async stop(): Promise<void> {
		if (this.stopped) {
			return;
		}
		this.stopped = true;

		if (this.reconnectTimer !== null) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		if (this.stream) {
			this.stream.cancel();
			this.stream = null;
		}

		for (const field of this.fields.values()) {
			field._stop();
		}
	}

	/**
	 * Dispose pattern support (TypeScript 5.2+).
	 *
	 * Calls stop() synchronously (best-effort). For full cleanup, prefer
	 * calling `await watcher.stop()` explicitly.
	 */
	[Symbol.dispose](): void {
		void this.stop();
	}

	private async loadSnapshot(): Promise<void> {
		const resp = await this.callGetConfig({
			tenantId: this.tenantId,
			includeDescriptions: false,
		});

		const valueMap = new Map<string, string>();
		if (resp.config) {
			for (const cv of resp.config.values) {
				valueMap.set(cv.fieldPath, typedValueToString(cv.value));
			}
		}

		for (const [path, field] of this.fields) {
			const raw = valueMap.get(path);
			field._loadInitial(raw ?? null);
		}
	}

	private subscribe(backoff = INITIAL_RECONNECT_BACKOFF): void {
		if (this.stopped) {
			return;
		}

		const fieldPaths = [...this.fields.keys()];
		const request: SubscribeRequest = {
			tenantId: this.tenantId,
			fieldPaths,
		};

		this.stream = this.configStub.subscribe(request, this.metadata);

		this.stream.on("data", (resp: SubscribeResponse) => {
			this.processChange(resp);
		});

		this.stream.on("error", (err: ServiceError) => {
			if (this.stopped) {
				return;
			}

			if (isRetryableError(err)) {
				this.scheduleReconnect(backoff);
			} else {
				// Non-retryable error: stop the watcher.
				void this.stop();
			}
		});

		this.stream.on("end", () => {
			if (this.stopped) {
				return;
			}
			// Server ended the stream (graceful shutdown). Reconnect.
			this.scheduleReconnect(backoff);
		});
	}

	private scheduleReconnect(backoff: number): void {
		if (this.stopped) {
			return;
		}

		const jitter = 0.5 + Math.random();
		const delay = Math.min(backoff * jitter, MAX_RECONNECT_BACKOFF);
		const nextBackoff = Math.min(backoff * RECONNECT_MULTIPLIER, MAX_RECONNECT_BACKOFF);

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.subscribe(nextBackoff);
		}, delay);
	}

	private processChange(resp: SubscribeResponse): void {
		if (!resp.change) {
			return;
		}

		const ch = resp.change;
		const field = this.fields.get(ch.fieldPath);
		if (!field) {
			// Change for an unregistered field -- ignore.
			return;
		}

		const oldRaw = ch.oldValue ? typedValueToString(ch.oldValue) : null;
		const newRaw = ch.newValue ? typedValueToString(ch.newValue) : null;

		const change: Change = {
			fieldPath: ch.fieldPath,
			oldValue: oldRaw,
			newValue: newRaw,
			version: ch.version,
			changedBy: ch.changedBy,
		};

		field._update(newRaw, change);
	}

	private callGetConfig(request: GetConfigRequest): Promise<GetConfigResponse> {
		return new Promise((resolve, reject) => {
			this.configStub.getConfig(
				request,
				this.metadata,
				{ deadline: Date.now() + this.timeout },
				(err: ServiceError | null, resp: GetConfigResponse) => {
					if (err) {
						reject(mapGrpcError(err));
					} else {
						resolve(resp);
					}
				},
			);
		});
	}
}

function isRetryableError(err: ServiceError): boolean {
	return RETRYABLE_CODES.has(err.code);
}
