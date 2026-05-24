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
| `insecure` | `boolean` | `false` | Use plaintext (no TLS) |
| `tls` | `TlsOptions` | — | Custom CA or client cert/key for mTLS. Ignored when `insecure` is true |
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

Non-superadmin roles require a `tenantId`. For users with access to multiple
tenants, pass a comma-separated list:

```typescript
const client = new ConfigClient('localhost:9090', {
  subject: 'alice',
  role: 'admin',
  tenantId: 'tenant-1,tenant-2', // access to multiple tenants
});
```

Each API call specifies which tenant to operate on via the `tenantId`
parameter. The server validates that the requested tenant is in the
caller's allowed list.

### JWT Authentication

For production deployments with JWT enabled on the server:

```typescript
const client = new ConfigClient('production:9090', {
  token: process.env.DECREE_TOKEN,
  insecure: false,
});
```

The JWT `tenant_ids` claim (array) determines which tenants the caller
can access. When `token` is set, the SDK sends it as a `Bearer` token
in the `authorization` metadata header. The `subject`, `role`, and
`tenantId` options are ignored.

## TLS

By default, the SDK connects with TLS using the system certificate store. To
use plaintext (local/dev only), set `insecure: true`:

```typescript
const client = new ConfigClient('localhost:9090', {
  insecure: true,
});
```

### Custom CA

To connect to a server with a private CA (self-signed or internal PKI):

```typescript
import { readFileSync } from 'node:fs';

const client = new ConfigClient('production:9090', {
  tls: {
    rootCerts: readFileSync('/path/to/ca.pem'),
  },
});
```

### mTLS (Mutual TLS)

To present a client certificate for mTLS authentication:

```typescript
import { readFileSync } from 'node:fs';

const client = new ConfigClient('production:9090', {
  tls: {
    rootCerts: readFileSync('/path/to/ca.pem'),
    privateKey: readFileSync('/path/to/client.key'),
    certChain: readFileSync('/path/to/client.crt'),
  },
});
```

`rootCerts`, `privateKey`, and `certChain` are all optional. Omit
`rootCerts` to use the system store while still sending a client cert.

### TlsOptions

| Option | Type | Description |
|--------|------|-------------|
| `rootCerts` | `Buffer` | PEM-encoded root CA certificate(s). Overrides the system store |
| `privateKey` | `Buffer` | PEM-encoded client private key for mTLS |
| `certChain` | `Buffer` | PEM-encoded client certificate chain for mTLS |

## Retry

The SDK retries transient gRPC errors with exponential backoff and jitter.

### Read vs write retry defaults

Read operations (`get`, `getAll`) retry on `UNAVAILABLE`, `DEADLINE_EXCEEDED`, and `RESOURCE_EXHAUSTED`. These are safe to retry because reads have no side effects.

Write operations (`set`, `setMany`, `setNull`) retry only on `UNAVAILABLE` by default. `DEADLINE_EXCEEDED` is excluded because the server may have already applied the write — retrying without a guarantee of idempotency can cause duplicate mutations.

To enable `DEADLINE_EXCEEDED` retries for a write, pass an `idempotencyKey`. This signals that the caller has ensured the write is safe to repeat (e.g. the value is the same as what the server would have written):

```typescript
await client.set('tenant-id', 'payments.fee', '0.05', { idempotencyKey: 'set-fee-2026-05-20' });
await client.setMany('tenant-id', { 'payments.fee': '0.05' }, { idempotencyKey: 'batch-1' });
await client.setNull('tenant-id', 'payments.fee', { idempotencyKey: 'clear-fee' });
```

If you set `retryableCodes` in `ClientOptions.retry`, that list overrides both read and write defaults for all operations.

### RetryConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxAttempts` | `number` | `3` | Maximum attempts (including the first) |
| `initialBackoff` | `number` | `100` | Initial backoff in milliseconds |
| `maxBackoff` | `number` | `5000` | Maximum backoff in milliseconds |
| `multiplier` | `number` | `2` | Backoff multiplier between attempts |
| `retryableCodes` | `GrpcStatus[]` | see above | gRPC codes that trigger a retry (overrides read/write split) |

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
