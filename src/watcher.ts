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
import { DecreeError, TypeMismatchError, mapGrpcError } from "./errors.js";
import type {
	GetConfigRequest,
	GetConfigResponse,
	ConfigServiceClient as GrpcConfigServiceClient,
	SubscribeRequest,
	SubscribeResponse,
} from "./generated/centralconfig/v1/config_service.js";
import type { Change } from "./types.js";

/** gRPC status codes that trigger automatic reconnection. */
const RETRYABLE_CODES = new Set([status.UNAVAILABLE, status.INTERNAL]);

/** Maximum reconnect backoff in milliseconds. */
const MAX_RECONNECT_BACKOFF = 30_000;

/** Default maximum number of unread changes buffered per WatchedField before oldest are dropped. */
const DEFAULT_QUEUE_SIZE = 1024;

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
	/**
	 * Maximum number of unread changes buffered for async iteration.
	 * When the queue is full, the oldest entry is dropped and `droppedChanges` is incremented.
	 * Default: 1024.
	 */
	readonly queueSize?: number;
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
	private readonly maxQueueSize: number;
	private _droppedChanges = 0;

	/** @internal */
	constructor(path: string, converter: Converter, options: FieldOptions<T>) {
		super();
		this.path = path;
		this.converter = converter;
		this.defaultValue = options.default;
		this.currentValue = options.default;
		this.maxQueueSize = options.queueSize ?? DEFAULT_QUEUE_SIZE;
	}

	/**
	 * Number of changes dropped because the queue was full.
	 *
	 * Increments whenever a slow consumer causes a buffered change to be evicted.
	 * Reset to zero only by creating a new WatchedField instance.
	 */
	get droppedChanges(): number {
		return this._droppedChanges;
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
	 * If `convertValue` throws (e.g. type mismatch or unsupported converter),
	 * the field falls back to its default value and emits a `'conversionError'` event.
	 * The error is non-fatal — the stream continues.
	 *
	 * @param rawValue - The raw string value from the snapshot, or null if absent.
	 * @internal
	 */
	_loadInitial(rawValue: string | null): void {
		if (rawValue === null) {
			this.currentValue = this.defaultValue;
		} else {
			try {
				this.currentValue = convertValue(rawValue, this.converter) as T;
			} catch (err) {
				console.warn(
					`[decree] convertValue failed for field "${this.path}" (value=${JSON.stringify(rawValue)}): ${err instanceof Error ? err.message : String(err)}`,
				);
				this.currentValue = this.defaultValue;
				const decreeErr =
					err instanceof DecreeError
						? err
						: new TypeMismatchError(err instanceof Error ? err.message : String(err));
				this.emit("conversionError", decreeErr, rawValue);
			}
		}
	}

	/**
	 * Update the field value from a ConfigChange event.
	 *
	 * Emits a `'change'` event if the new value differs from the current value.
	 * Enqueues a Change for async iteration.
	 *
	 * If `convertValue` throws (e.g. type mismatch or unsupported converter),
	 * the field retains its current value, emits a `'conversionError'` event,
	 * and returns without updating. The stream continues processing other fields.
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
			try {
				this.currentValue = convertValue(rawValue, this.converter) as T;
			} catch (err) {
				console.warn(
					`[decree] convertValue failed for field "${this.path}" (value=${JSON.stringify(rawValue)}): ${err instanceof Error ? err.message : String(err)}`,
				);
				const decreeErr =
					err instanceof DecreeError
						? err
						: new TypeMismatchError(err instanceof Error ? err.message : String(err));
				this.emit("conversionError", decreeErr, rawValue);
				return;
			}
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
			if (this.changeQueue.length >= this.maxQueueSize) {
				this.changeQueue.shift();
				this._droppedChanges++;
			}
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
 * Typed event map for WatchedField.
 */
export interface WatchedFieldEvents {
	/**
	 * Emitted when the field value changes.
	 *
	 * Arguments are the old value and the new value.
	 */
	change: [oldValue: unknown, newValue: unknown];
	/**
	 * Emitted when `convertValue` throws during `_loadInitial` or `_update`.
	 *
	 * The field retains its previous value (or default for `_loadInitial`).
	 * The gRPC stream continues — this error is non-fatal.
	 */
	conversionError: [err: DecreeError, rawValue: string];
}

/**
 * Typed event map for ConfigWatcher.
 *
 * @example
 * ```ts
 * watcher.on('subscriptionError', (err) => {
 *   console.warn('subscription error:', err.message);
 * });
 * ```
 */
export interface ConfigWatcherEvents {
	/**
	 * Emitted when a subscription error occurs.
	 *
	 * For retryable errors (UNAVAILABLE, INTERNAL) the watcher reconnects automatically.
	 * For non-retryable errors the watcher stops after emitting this event.
	 * The `err` argument is a typed `DecreeError` (e.g. `UnavailableError`).
	 */
	subscriptionError: [err: DecreeError];
}

/**
 * ConfigWatcher subscribes to live configuration changes for a tenant.
 *
 * Created via `client.watch(tenantId)`. Register fields with `field()` before
 * calling `start()`. The watcher loads an initial snapshot via GetConfig, then
 * opens a Subscribe stream for real-time updates. On transient errors
 * (UNAVAILABLE, INTERNAL), it automatically reconnects with exponential backoff.
 *
 * Subscription errors (both retryable and fatal) are emitted as `'subscriptionError'`
 * events. Retryable errors trigger automatic reconnection; fatal errors cause the
 * watcher to stop.
 *
 * @example
 * ```ts
 * const client = new ConfigClient('localhost:9090', { subject: 'myapp' });
 * const watcher = client.watch('tenant-id');
 *
 * const fee = watcher.field('payments.fee', Number, { default: 0.01 });
 * const enabled = watcher.field('payments.enabled', Boolean, { default: false });
 *
 * watcher.on('subscriptionError', (err) => {
 *   console.warn('watcher error:', err.message);
 * });
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
export class ConfigWatcher extends EventEmitter {
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
		super();
		this.configStub = configStub;
		this.metadata = metadata;
		this.timeout = timeout;
		this.tenantId = tenantId;
	}

	override on<K extends keyof ConfigWatcherEvents>(
		event: K,
		listener: (...args: ConfigWatcherEvents[K]) => void,
	): this;
	override on(event: string | symbol, listener: (...args: unknown[]) => void): this;
	override on(event: string | symbol, listener: (...args: unknown[]) => void): this {
		return super.on(event, listener);
	}

	override once<K extends keyof ConfigWatcherEvents>(
		event: K,
		listener: (...args: ConfigWatcherEvents[K]) => void,
	): this;
	override once(event: string | symbol, listener: (...args: unknown[]) => void): this;
	override once(event: string | symbol, listener: (...args: unknown[]) => void): this {
		return super.once(event, listener);
	}

	override emit<K extends keyof ConfigWatcherEvents>(
		event: K,
		...args: ConfigWatcherEvents[K]
	): boolean;
	override emit(event: string | symbol, ...args: unknown[]): boolean;
	override emit(event: string | symbol, ...args: unknown[]): boolean {
		return super.emit(event, ...args);
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
	stop(): Promise<void> {
		if (this.stopped) {
			return Promise.resolve();
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
		return Promise.resolve();
	}

	/**
	 * Dispose pattern support (TypeScript 5.2+).
	 *
	 * Calls stop() synchronously (best-effort). For full cleanup, prefer
	 * `await using` or calling `await watcher.stop()` explicitly.
	 */
	[Symbol.dispose](): void {
		void this.stop();
	}

	/**
	 * Async dispose pattern support — use with `await using`.
	 */
	async [Symbol.asyncDispose](): Promise<void> {
		await this.stop();
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

	private subscribe(initialBackoff = INITIAL_RECONNECT_BACKOFF): void {
		if (this.stopped) {
			return;
		}

		const fieldPaths = [...this.fields.keys()];
		const request: SubscribeRequest = {
			tenantId: this.tenantId,
			fieldPaths,
		};

		this.stream = this.configStub.subscribe(request, this.metadata);

		let backoff = initialBackoff;

		this.stream.on("data", (resp: SubscribeResponse) => {
			backoff = INITIAL_RECONNECT_BACKOFF;
			this.processChange(resp);
		});

		this.stream.on("error", (err: ServiceError) => {
			if (this.stopped) {
				return;
			}

			this.emit("subscriptionError", mapGrpcError(err));

			if (isRetryableError(err)) {
				this.scheduleReconnect(backoff);
			} else {
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
			void this.reloadAndSubscribe(nextBackoff);
		}, delay);
	}

	private async reloadAndSubscribe(backoff: number): Promise<void> {
		if (this.stopped) {
			return;
		}
		try {
			await this.loadSnapshot();
		} catch {
			this.scheduleReconnect(backoff);
			return;
		}
		this.subscribe(INITIAL_RECONNECT_BACKOFF);
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
