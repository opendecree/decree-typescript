/**
 * OpenDecree TypeScript SDK — schema-driven configuration management.
 *
 * @packageDocumentation
 */

export const VERSION = "0.2.0-alpha.1";
export const SUPPORTED_SERVER_VERSION = ">=0.8.0,<1.0.0";
export const PROTO_VERSION = "v1";

// Public types
export type {
	ConfigValue,
	Change,
	ServerInfo,
	ServerVersion,
	RetryConfig,
	ClientOptions,
} from "./types.js";

// Error hierarchy
export {
	DecreeError,
	NotFoundError,
	AlreadyExistsError,
	InvalidArgumentError,
	LockedError,
	ChecksumMismatchError,
	PermissionDeniedError,
	UnavailableError,
	IncompatibleServerError,
	TypeMismatchError,
	mapGrpcError,
} from "./errors.js";

// Client
export { ConfigClient } from "./client.js";

// Watcher
export { ConfigWatcher, WatchedField } from "./watcher.js";

// Utilities (re-export for advanced users)
export { withRetry } from "./retry.js";
export { createChannel } from "./channel.js";
export { convertValue, typedValueToString } from "./convert.js";
export type { Converter } from "./convert.js";
export { checkVersionCompatible, parseVersion, satisfies } from "./compat.js";
