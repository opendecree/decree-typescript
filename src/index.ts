/**
 * OpenDecree TypeScript SDK — schema-driven configuration management.
 *
 * @packageDocumentation
 */

export { SUPPORTED_SERVER_VERSION, VERSION } from "./version.js";
export const PROTO_VERSION = "v1";

export { createChannel } from "./channel.js";
// Client
export { ConfigClient } from "./client.js";
export { checkVersionCompatible, parseVersion, satisfies } from "./compat.js";
export type { Converter, SetValue } from "./convert.js";
export { convertValue, typedValueToString, valueToTyped } from "./convert.js";
// Error hierarchy
export {
	AlreadyExistsError,
	CancelledError,
	ChecksumMismatchError,
	DataLossError,
	DeadlineExceededError,
	DecreeError,
	IncompatibleServerError,
	InvalidArgumentError,
	LockedError,
	mapGrpcError,
	NotFoundError,
	OutOfRangeError,
	PermissionDeniedError,
	ResourceExhaustedError,
	TypeMismatchError,
	UnavailableError,
	UnimplementedError,
} from "./errors.js";
// Utilities (re-export for advanced users)
export { withRetry } from "./retry.js";
// Public types
export type {
	Change,
	ClientOptions,
	ConfigValue,
	RetryConfig,
	ServerInfo,
	ServerVersion,
	TlsOptions,
} from "./types.js";
export type { ConfigWatcherEvents } from "./watcher.js";
// Watcher
export { ConfigWatcher, WatchedField } from "./watcher.js";
