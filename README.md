# OpenDecree TypeScript SDK

[![CI](https://github.com/opendecree/decree-typescript/actions/workflows/ci.yml/badge.svg)](https://github.com/opendecree/decree-typescript/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@opendecree/sdk)](https://www.npmjs.com/package/@opendecree/sdk)
[![Node](https://img.shields.io/node/v/@opendecree/sdk)](https://www.npmjs.com/package/@opendecree/sdk)
[![Coverage](https://img.shields.io/badge/coverage-98%25-brightgreen)](https://github.com/opendecree/decree-typescript)
[![License](https://img.shields.io/github/license/opendecree/decree-typescript)](LICENSE)

TypeScript SDK for [OpenDecree](https://github.com/opendecree/decree) -- schema-driven configuration management.

## Install

```bash
npm install @opendecree/sdk
```

## Quick Start

```typescript
import { ConfigClient } from '@opendecree/sdk';

const client = new ConfigClient('localhost:9090', { subject: 'myapp' });
try {
  // Get config values (default: string)
  const fee = await client.get('tenant-id', 'payments.fee');

  // Typed gets via runtime converters
  const retries = await client.get('tenant-id', 'payments.retries', Number);
  const enabled = await client.get('tenant-id', 'payments.enabled', Boolean);

  // Nullable gets
  const optional = await client.get('tenant-id', 'payments.fee', Number, { nullable: true });

  // Set values
  await client.set('tenant-id', 'payments.fee', '0.5%');

  // Set multiple values atomically
  await client.setMany('tenant-id', {
    'payments.fee': '0.5%',
    'payments.retries': '3',
  });
} finally {
  client.close();
}
```

## Watch for Changes

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
console.log(fee.value);     // number
console.log(enabled.value); // boolean

// EventEmitter pattern
fee.on('change', (oldVal, newVal) => {
  console.log(`Fee changed: ${oldVal} -> ${newVal}`);
});

// Or async iteration (yields Change objects)
for await (const change of fee) {
  console.log(change.fieldPath, change.newValue);
}

// Cleanup
await watcher.stop();
client.close();
```

## Documentation

- [Quick Start](docs/quickstart.md) -- install, first get/set, typed gets, error handling
- [Configuration](docs/configuration.md) -- all client options, auth, TLS, retry, timeouts
- [Watching](docs/watching.md) -- ConfigWatcher, WatchedField, EventEmitter, async iteration

## Requirements

- Node.js 20+
- A running OpenDecree server (v0.3.0+)

## License

Apache License 2.0 -- see [LICENSE](LICENSE).
