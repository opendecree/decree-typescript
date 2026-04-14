# Watching Configuration Changes

The SDK provides live configuration subscriptions through `ConfigWatcher` and
`WatchedField`. Values update in real-time from the server's Subscribe stream,
with automatic reconnection on transient errors.

## Overview

1. Create a watcher with `client.watch(tenantId)`
2. Register fields with `watcher.field(path, converter, options)`
3. Call `watcher.start()` to load the initial snapshot and begin streaming
4. Read values synchronously or observe changes via events / async iteration
5. Call `watcher.stop()` when done

## Basic Usage

```typescript
import { ConfigClient } from '@opendecree/sdk';

const client = new ConfigClient('localhost:9090', { subject: 'myapp' });
const watcher = client.watch('tenant-id');

// Register fields before starting
const fee = watcher.field('payments.fee', Number, { default: 0.01 });
const enabled = watcher.field('payments.enabled', Boolean, { default: false });

// Load snapshot + start streaming
await watcher.start();

// Synchronous access to current values
console.log(fee.value);     // 0.5 (from server)
console.log(enabled.value); // true (from server)

// Cleanup
await watcher.stop();
client.close();
```

## WatchedField

Each call to `watcher.field()` returns a `WatchedField<T>` instance. The type
parameter `T` is inferred from the converter and default value.

### Converters

| Converter | Type `T` | Example |
|-----------|----------|---------|
| `String` | `string` | `watcher.field('app.name', String, { default: '' })` |
| `Number` | `number` | `watcher.field('app.retries', Number, { default: 3 })` |
| `Boolean` | `boolean` | `watcher.field('app.enabled', Boolean, { default: false })` |

### Synchronous Access

The `.value` getter always returns the latest known value. Before
`watcher.start()` completes, it returns the default. After the snapshot
loads, it reflects the server value. Subsequently it updates in real-time.

```typescript
const fee = watcher.field('payments.fee', Number, { default: 0.01 });
console.log(fee.value); // 0.01 (default, before start)

await watcher.start();
console.log(fee.value); // 0.5 (from server snapshot)

// Later, after a server-side update:
console.log(fee.value); // 0.75 (updated in real-time)
```

## Observing Changes

### EventEmitter Pattern

`WatchedField` extends `EventEmitter`. Listen for `'change'` events:

```typescript
fee.on('change', (oldValue: number, newValue: number) => {
  console.log(`Fee changed: ${oldValue} -> ${newValue}`);
});
```

The callback fires only when the value actually changes (old !== new).

### Async Iteration

`WatchedField` implements `Symbol.asyncIterator`, yielding `Change` objects:

```typescript
import type { Change } from '@opendecree/sdk';

for await (const change of fee) {
  console.log(change);
  // {
  //   fieldPath: 'payments.fee',
  //   oldValue: '0.5',
  //   newValue: '0.75',
  //   version: 42,
  //   changedBy: 'admin'
  // }
}
```

The iterator completes when the watcher is stopped. Note that `Change`
contains raw string values (`oldValue`, `newValue`) as received from the
server, while the `WatchedField.value` getter returns the converted type.

### One-Shot Listener

Use `once()` (inherited from `EventEmitter`) if you only need the next change:

```typescript
fee.once('change', (oldVal, newVal) => {
  console.log(`First change: ${oldVal} -> ${newVal}`);
});
```

## Auto-Reconnect

The Subscribe stream reconnects automatically on transient gRPC errors
(`UNAVAILABLE`, `INTERNAL`) with exponential backoff:

- Initial backoff: 500 ms
- Multiplier: 2x
- Maximum backoff: 30 seconds
- Jitter: 0.5x to 1.5x randomization

Non-retryable errors (e.g., `PERMISSION_DENIED`) stop the watcher.

## Lifecycle

### Registration Before Start

Fields must be registered before calling `start()`. Attempting to register
after start throws a `DecreeError`:

```typescript
const watcher = client.watch('tenant-id');
await watcher.start();
watcher.field('late.field', String, { default: '' }); // throws DecreeError
```

### Stopping

`stop()` is safe to call multiple times. It cancels the stream, clears
reconnect timers, and signals all `WatchedField` async iterators to complete:

```typescript
await watcher.stop();
await watcher.stop(); // no-op
```

### Dispose Pattern (TypeScript 5.2+)

`ConfigWatcher` supports `Symbol.dispose` for use with `using`:

```typescript
{
  using watcher = client.watch('tenant-id');
  const fee = watcher.field('payments.fee', Number, { default: 0.01 });
  await watcher.start();
  // ...
} // watcher.stop() called automatically (best-effort)
```

Note: Since `stop()` is async, the dispose pattern is best-effort.
For guaranteed cleanup, call `await watcher.stop()` explicitly.

## Full Example

```typescript
import { ConfigClient } from '@opendecree/sdk';

async function main() {
  const client = new ConfigClient('localhost:9090', { subject: 'myapp' });

  try {
    const watcher = client.watch('tenant-id');

    const fee = watcher.field('payments.fee', Number, { default: 0.01 });
    const currency = watcher.field('payments.currency', String, { default: 'USD' });
    const enabled = watcher.field('payments.enabled', Boolean, { default: false });

    await watcher.start();

    console.log(`Fee: ${fee.value}, Currency: ${currency.value}, Enabled: ${enabled.value}`);

    fee.on('change', (oldVal, newVal) => {
      console.log(`Fee updated: ${oldVal} -> ${newVal}`);
    });

    // Keep running until interrupted
    await new Promise<void>((resolve) => {
      process.on('SIGINT', async () => {
        await watcher.stop();
        resolve();
      });
    });
  } finally {
    client.close();
  }
}

main().catch(console.error);
```
