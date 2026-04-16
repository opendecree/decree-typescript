# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0-alpha.1] - 2026-04-16

### Changed

- **Breaking:** Regenerated proto stubs for decree v0.8.0-alpha.1
- `VersionService` replaced by `ServerService` (`GetServerVersion` -> `GetServerInfo`)
- New `ServerInfo` type replaces `ServerVersion` (adds `features` map)
- New `serverInfo` property on `ConfigClient` (returns `ServerInfo` with version, commit, and features)
- `SUPPORTED_SERVER_VERSION` updated to `>=0.8.0,<1.0.0`

### Deprecated

- `ServerVersion` type alias (use `ServerInfo` instead)
- `serverVersion` property on `ConfigClient` (use `serverInfo` instead)

## [0.1.0] - 2026-04-12

### Added

- `ConfigClient` with promise-based API wrapping gRPC stubs
- Typed `get()` via function overloads with `Number`, `Boolean`, `String` converters
- Nullable gets returning `T | null` instead of throwing
- `set()`, `setMany()`, and `setNull()` for writing configuration
- `getAll()` for reading all tenant config as a record
- `ConfigWatcher` for live configuration subscriptions via server-streaming RPC
- `WatchedField<T>` with synchronous `.value` getter, EventEmitter `'change'` events, and `Symbol.asyncIterator`
- Auto-reconnect with exponential backoff on transient stream errors
- Error hierarchy mapping gRPC status codes to typed exceptions (`NotFoundError`, `PermissionDeniedError`, etc.)
- Exponential backoff retry with jitter for transient gRPC errors
- Auth metadata support (x-subject, x-role, x-tenant-id, Bearer token)
- Server version compatibility checking
- `Symbol.dispose` support on `ConfigClient` and `ConfigWatcher` (TypeScript 5.2+)

[0.2.0-alpha.1]: https://github.com/opendecree/decree-typescript/releases/tag/v0.2.0-alpha.1
[0.1.0]: https://github.com/opendecree/decree-typescript/releases/tag/v0.1.0
