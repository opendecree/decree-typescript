/**
 * OpenDecree TypeScript SDK — schema-driven configuration management.
 *
 * @packageDocumentation
 */

export const VERSION = "0.2.0-alpha.1";
export const SUPPORTED_SERVER_VERSION = ">=0.8.0,<1.0.0";
export const PROTO_VERSION = "v1";

export { createChannel } from "./channel.js";
// Client
export { ConfigClient } from "./client.js";
export { checkVersionCompatible, parseVersion, satisfies } from "./compat.js";
export type { Converter } from "./convert.js";
export { convertValue, typedValueToString } from "./convert.js";
// Error hierarchy
export {
	AlreadyExistsError,
	ChecksumMismatchError,
	DecreeError,
	IncompatibleServerError,
	InvalidArgumentError,
	LockedError,
	mapGrpcError,
	NotFoundError,
	PermissionDeniedError,
	TypeMismatchError,
	UnavailableError,
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
} from "./types.js";
// Watcher
export { ConfigWatcher, WatchedField } from "./watcher.js";
