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

#### Rotating the Token

JWTs expire. When you obtain a fresh token (e.g. just before the current one
expires, or after a refresh-token exchange), call `setToken()` to swap it in
for all subsequent RPCs — including watcher reconnects — without recreating the
client:

```typescript
setToken(token: string): void
```

```typescript
const client = new ConfigClient('production:9090', { token: initialJwt });

// Later, before the current token expires:
client.setToken(await refreshAccessToken());
```

Pass the raw JWT **without** the `Bearer ` prefix — the SDK adds it. `setToken()`
also switches the client into JWT auth mode: it removes any metadata-header
credentials (`x-subject`, `x-role`, `x-tenant-id`) that were set at construction
time, so a client started in development mode can be promoted to token auth at
runtime.

## Reading and Writing Values

### Reading a single value

`get()` returns a string by default. Pass `String`, `Number`, or `Boolean` as
the third argument to convert the raw value at runtime; the return type narrows
automatically. See [Type Mapping](#type-mapping) for the full conversion table
and its limitations.

```typescript
const fee = await client.get('tenant-id', 'payments.fee');            // string
const retries = await client.get('tenant-id', 'payments.retries', Number); // number
const enabled = await client.get('tenant-id', 'payments.enabled', Boolean); // boolean
```

### Reading all values

`getAll()` fetches every configuration value for a tenant in one call and
returns a plain record mapping each field path to its **string** value:

```typescript
getAll(
  tenantId: string,
  options?: { timeout?: number; signal?: AbortSignal },
): Promise<Record<string, string>>
```

```typescript
const config = await client.getAll('tenant-id');
// {
//   'payments.fee': '0.5',
//   'payments.enabled': 'true',
//   'payments.window': '24h',
// }
```

Values are always strings here — there is no per-field converter. Each value is
the canonical string form described in [Type Mapping](#type-mapping). Convert
individual values yourself (e.g. `Number(config['payments.fee'])`), or use
`get(path, Number)` when you need a typed read of a specific field.

### Writing values

`set()` sends the value as a string and lets the server coerce it to the
schema-defined type. For type-safe writes that send a native proto value, prefer
the typed setters:

```typescript
setNumber(tenantId: string, fieldPath: string, value: number, options?: SetOptions): Promise<void>
setBool(tenantId: string, fieldPath: string, value: boolean, options?: SetOptions): Promise<void>
setTime(tenantId: string, fieldPath: string, value: Date, options?: SetOptions): Promise<void>
setDuration(tenantId: string, fieldPath: string, value: string, options?: SetOptions): Promise<void>
```

```typescript
await client.setNumber('tenant-id', 'payments.fee', 0.5);
await client.setBool('tenant-id', 'payments.enabled', true);
await client.setTime('tenant-id', 'payments.cutoff', new Date('2026-01-01T00:00:00Z'));
await client.setDuration('tenant-id', 'payments.window', '24h');
```

Notes:

- `setNumber` sends a proto `numberValue`, `setBool` a `boolValue`, and
  `setTime` a `timeValue` (from the `Date`).
- `setDuration` takes a **duration string** (e.g. `"1h30m"`, `"300s"`,
  `"500ms"`), not a number. It is sent as a string value and the server parses
  and validates the duration format.
- Each setter accepts the same `options` as `set()`: `timeout`,
  `idempotencyKey` (see [Retry](#retry)), `signal` (an `AbortSignal`), and
  `expectedChecksum` for optimistic concurrency control.

### Writing multiple values atomically

`setMany()` writes several fields in a single atomic request. The string-keyed
record accepts **native JavaScript values** — `string`, `number`, `boolean`, or
`Date` — and each is converted to the matching proto value (number →
`numberValue`, boolean → `boolValue`, `Date` → `timeValue`, string →
`stringValue`):

```typescript
setMany(
  tenantId: string,
  values: Record<string, string | number | boolean | Date>,
  options?: {
    description?: string;
    timeout?: number;
    idempotencyKey?: string;
    signal?: AbortSignal;
    expectedChecksums?: Record<string, string>;
  },
): Promise<void>
```

```typescript
await client.setMany('tenant-id', {
  'payments.fee': 0.5,                          // number
  'payments.enabled': true,                     // boolean
  'payments.cutoff': new Date('2026-01-01T00:00:00Z'), // Date
  'payments.window': '24h',                     // string (e.g. a duration)
}, {
  description: 'Q1 payment config update',
});
```

The optional `description` is recorded in the audit log. `expectedChecksums`
maps individual field paths to their expected checksums for per-field optimistic
concurrency control. As with the single-field setters, durations are passed as
strings.

## Type Mapping

OpenDecree stores every value internally as a string. The server's schema gives
each field a type (the Go/`FieldType` column below); on the wire that value
travels inside a `TypedValue` proto, and the SDK converts it to a TypeScript
value at the boundary. The table shows the full round trip.

| Schema type (`FieldType`) | Proto `TypedValue` field | Raw string wire form | `get()` converter | TypeScript value you get |
|---------------------------|--------------------------|----------------------|-------------------|--------------------------|
| `integer` | `integerValue` | decimal string, e.g. `"42"`, `"-1"` | `Number` | `number` (throws if outside safe-integer range — see below) |
| `number` | `numberValue` | decimal string, e.g. `"3.14"`, `"0.025"` | `Number` | `number` |
| `string` | `stringValue` | the string itself | `String` (default) | `string` |
| `bool` | `boolValue` | `"true"` or `"false"` | `Boolean` | `boolean` |
| `time` | `timeValue` | RFC 3339 timestamp, e.g. `"2025-01-15T09:30:00.000Z"` | `String` only | `string` |
| `duration` | `durationValue` | Go-style duration, e.g. `"24h"`, `"30m"`, `"45s"`, `"1.5s"`, `"0s"` | `String` only | `string` |
| `url` | `urlValue` | the absolute URL string | `String` only | `string` |
| `json` | `jsonValue` | JSON-encoded string, e.g. `'{"key":"value"}'` | `String` only | `string` |

### `time`, `duration`, `url`, and `json` come back as strings

The `get()` and `WatchedField` converters are limited to `String`, `Number`, and
`Boolean` (the `Converter` type). There is no built-in converter for `time`,
`duration`, `url`, or `json`, so values of those types are returned as their
canonical string form and you parse them yourself:

```typescript
// time → ISO 8601 / RFC 3339 string
const cutoffStr = await client.get('tenant-id', 'payments.cutoff');
const cutoff = new Date(cutoffStr); // "2025-01-15T09:30:00.000Z" → Date

// duration → Go-style duration string (parse as needed)
const window = await client.get('tenant-id', 'payments.window'); // "24h"

// url → string
const endpoint = await client.get('tenant-id', 'payments.endpoint'); // "https://..."

// json → JSON-encoded string
const raw = await client.get('tenant-id', 'payments.options');
const options = JSON.parse(raw); // { ... }
```

`getAll()` returns these same canonical strings for every field.

### Converters are limited to `String` / `Number` / `Boolean`

The third argument to `get()` (and `watcher.field()` / `watcher.addField()`)
must be one of the built-in constructors `String`, `Number`, or `Boolean`.
Passing anything else throws a `TypeMismatchError` (`"unsupported converter
type"`). To turn a `time`, `duration`, `url`, or `json` value into a richer
type, read it as a string and convert it in your own code.

### Large integers and the BigInt caveat

JavaScript's `number` is an IEEE-754 double, so integers beyond
`Number.MAX_SAFE_INTEGER` (2^53 − 1) and below `Number.MIN_SAFE_INTEGER` lose
precision. To avoid silently returning a wrong value, the `Number` converter
**rejects** integer strings outside the safe range and throws a
`TypeMismatchError`:

```typescript
// "9007199254740992" (MAX_SAFE_INTEGER + 1)
await client.get('tenant-id', 'counters.big', Number);
// throws TypeMismatchError: integer "9007199254740992" exceeds safe integer range; use BigInt
```

For values that may exceed the safe-integer range, read the field as a string
and construct a `BigInt` yourself:

```typescript
const raw = await client.get('tenant-id', 'counters.big'); // string
const big = BigInt(raw);
```

This guard only applies to **integer-valued** strings. Large floating-point
values (e.g. `"1e20"`) are not integers and convert without throwing — they are
inherently approximate.

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
// Throws IncompatibleServerError if server version is outside >=0.8.0,<1.0.0
```

The server info is fetched once and cached for the lifetime of the client:

```typescript
const info = await client.serverInfo;
console.log(info);
// {
//   version: "0.8.1",
//   commit: "abc123",
//   features: {
//     schema: true,
//     config: true,
//     audit: true,
//     usage_tracking: false,
//     jwt_auth: false,
//     http_gateway: true,
//   },
// }
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
