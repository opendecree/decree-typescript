# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

[0.1.0]: https://github.com/opendecree/decree-typescript/releases/tag/v0.1.0
