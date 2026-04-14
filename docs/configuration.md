# Configuration

## ClientOptions

All options are optional. Pass them as the second argument to `ConfigClient`:

```typescript
import { ConfigClient } from '@opendecree/sdk';

const client = new ConfigClient('localhost:9090', {
  subject: 'myapp',
  role: 'admin',
  timeout: 5000,
  retry: { maxAttempts: 5 },
});
```

### Option Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `subject` | `string` | — | Identity for `x-subject` metadata header |
| `role` | `string` | `"superadmin"` | Role for `x-role` metadata header |
| `tenantId` | `string` | — | Default tenant for `x-tenant-id` metadata header |
| `token` | `string` | — | Bearer token. When set, metadata headers are not sent |
| `insecure` | `boolean` | `true` | Use plaintext (no TLS) |
| `timeout` | `number` | `10000` | Per-RPC timeout in milliseconds |
| `retry` | `RetryConfig \| false` | See below | Retry configuration. Set to `false` to disable |

## Authentication

### Development Mode (Default)

In development mode, identity is passed via gRPC metadata headers:

```typescript
const client = new ConfigClient('localhost:9090', {
  subject: 'myapp',
  role: 'superadmin', // default
  tenantId: 'tenant-1',
});
```

The server reads `x-subject`, `x-role`, and `x-tenant-id` from request
metadata to determine authorization.

### JWT Authentication

For production deployments with JWT enabled on the server:

```typescript
const client = new ConfigClient('production:9090', {
  token: process.env.DECREE_TOKEN,
  insecure: false,
});
```

When `token` is set, the SDK sends it as a `Bearer` token in the
`authorization` metadata header. The `subject`, `role`, and `tenantId`
options are ignored.

## TLS

By default, the SDK connects with plaintext (`insecure: true`). For
production, disable insecure mode to use TLS:

```typescript
const client = new ConfigClient('production:9090', {
  insecure: false,
});
```

This uses `@grpc/grpc-js` default TLS credentials, which trust the system
certificate store.

## Retry

The SDK retries transient gRPC errors with exponential backoff and jitter.

### RetryConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxAttempts` | `number` | `3` | Maximum attempts (including the first) |
| `initialBackoff` | `number` | `100` | Initial backoff in milliseconds |
| `maxBackoff` | `number` | `5000` | Maximum backoff in milliseconds |
| `multiplier` | `number` | `2` | Backoff multiplier between attempts |
| `retryableCodes` | `GrpcStatus[]` | `[UNAVAILABLE, DEADLINE_EXCEEDED]` | gRPC codes that trigger a retry |

### Examples

```typescript
// Custom retry
const client = new ConfigClient('localhost:9090', {
  retry: {
    maxAttempts: 5,
    initialBackoff: 200,
    maxBackoff: 10000,
    multiplier: 3,
  },
});

// Disable retry
const client = new ConfigClient('localhost:9090', {
  retry: false,
});
```

## Timeouts

The `timeout` option sets a per-RPC deadline in milliseconds. It applies to
every gRPC call (get, set, getAll, setMany, version check):

```typescript
const client = new ConfigClient('localhost:9090', {
  timeout: 5000, // 5 seconds
});
```

The default is 10,000 ms (10 seconds).

## Server Compatibility

The SDK validates that the connected server is within a supported version range.
Use `checkCompatibility()` to verify explicitly:

```typescript
const client = new ConfigClient('localhost:9090');
await client.checkCompatibility();
// Throws IncompatibleServerError if server version is outside >=0.3.0,<1.0.0
```

The server version is fetched once and cached for the lifetime of the client:

```typescript
const version = await client.serverVersion;
console.log(version); // { version: "0.3.1", commit: "abc123" }
```

## Error Types

All errors extend `DecreeError`. The following table maps gRPC status codes
to SDK error classes:

| gRPC Status | Error Class | When |
|-------------|-------------|------|
| `NOT_FOUND` | `NotFoundError` | Field or tenant does not exist |
| `ALREADY_EXISTS` | `AlreadyExistsError` | Creating a duplicate resource |
| `INVALID_ARGUMENT` | `InvalidArgumentError` | Bad request parameters |
| `FAILED_PRECONDITION` | `LockedError` | Field is locked |
| `ABORTED` | `ChecksumMismatchError` | Optimistic concurrency conflict |
| `PERMISSION_DENIED` | `PermissionDeniedError` | Insufficient permissions |
| `UNAUTHENTICATED` | `PermissionDeniedError` | Missing or invalid credentials |
| `UNAVAILABLE` | `UnavailableError` | Server unreachable |
| — | `IncompatibleServerError` | Server version mismatch |
| — | `TypeMismatchError` | Typed getter received wrong type |

All error classes expose an optional `.code` property with the underlying
gRPC status code (when applicable).
