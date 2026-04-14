# Quick Start

## Installation

```bash
npm install @opendecree/sdk
```

## Connect to the Server

```typescript
import { ConfigClient } from '@opendecree/sdk';

const client = new ConfigClient('localhost:9090', { subject: 'myapp' });
```

The `subject` identifies your application in audit logs. For production setups
with JWT authentication, pass a `token` instead:

```typescript
const client = new ConfigClient('localhost:9090', { token: 'eyJhbG...' });
```

## Get and Set Values

```typescript
try {
  // Read a string value (default type)
  const fee = await client.get('tenant-id', 'payments.fee');
  console.log(fee); // "0.5%"

  // Write a value
  await client.set('tenant-id', 'payments.fee', '1.0%');
} finally {
  client.close();
}
```

## Typed Gets

Pass a built-in constructor as the third argument to convert the value at
runtime. The return type narrows automatically.

```typescript
const retries = await client.get('tenant-id', 'payments.retries', Number);
// retries: number

const enabled = await client.get('tenant-id', 'payments.enabled', Boolean);
// enabled: boolean

const name = await client.get('tenant-id', 'payments.name', String);
// name: string (explicit, same as default)
```

## Nullable Gets

Some fields may not have a value set. By default, `get()` throws a
`NotFoundError`. Pass `{ nullable: true }` to return `null` instead:

```typescript
const fee = await client.get('tenant-id', 'payments.fee', Number, {
  nullable: true,
});
// fee: number | null
```

## Set Multiple Values Atomically

```typescript
await client.setMany('tenant-id', {
  'payments.fee': '0.5%',
  'payments.retries': '3',
  'payments.enabled': 'true',
});
```

## Clear a Value

```typescript
await client.setNull('tenant-id', 'payments.fee');
```

## Error Handling

All SDK errors extend `DecreeError`. Catch specific error types for
fine-grained control:

```typescript
import {
  NotFoundError,
  InvalidArgumentError,
  PermissionDeniedError,
  UnavailableError,
} from '@opendecree/sdk';

try {
  await client.get('tenant-id', 'missing.field');
} catch (err) {
  if (err instanceof NotFoundError) {
    console.log('Field not found');
  } else if (err instanceof UnavailableError) {
    console.log('Server unreachable');
  } else {
    throw err;
  }
}
```

## Dispose Pattern (TypeScript 5.2+)

`ConfigClient` supports `Symbol.dispose`, so you can use the `using`
declaration for automatic cleanup:

```typescript
{
  using client = new ConfigClient('localhost:9090', { subject: 'myapp' });
  const fee = await client.get('tenant-id', 'payments.fee');
} // client.close() called automatically
```

## Next Steps

- [Configuration](configuration.md) -- all client options, auth, TLS, retry, and timeouts
- [Watching](watching.md) -- live config subscriptions with ConfigWatcher and WatchedField
