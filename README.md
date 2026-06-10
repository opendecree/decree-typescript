# OpenDecree TypeScript SDK

[![CI](https://github.com/opendecree/decree-typescript/actions/workflows/ci.yml/badge.svg)](https://github.com/opendecree/decree-typescript/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@opendecree/sdk)](https://www.npmjs.com/package/@opendecree/sdk)
[![License](https://img.shields.io/github/license/opendecree/decree-typescript)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-opendecree.github.io-teal)](https://opendecree.github.io/decree-typescript)
[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/opendecree/decree-typescript)

TypeScript SDK for [OpenDecree](https://github.com/opendecree/decree) -- schema-driven configuration management.

> **Alpha** -- This SDK is under active development. APIs and behavior may change without notice between versions.

## Requirements

- Node.js **≥ 22** (ESM-only package — CommonJS is not supported)

## Install

```bash
npm install @opendecree/sdk
```

## Quick Start

The SDK implements `Symbol.dispose` / `Symbol.asyncDispose`, so you can use TypeScript 5.2's `using` statement for automatic cleanup — no try/finally needed.

```typescript
import { ConfigClient } from '@opendecree/sdk';

// `using` closes the gRPC channel automatically when the block exits
await using client = new ConfigClient('localhost:9090', { subject: 'myapp' });

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
```

<details>
<summary>Prefer try/finally?</summary>

```typescript
const client = new ConfigClient('localhost:9090', { subject: 'myapp' });
try {
  const fee = await client.get('tenant-id', 'payments.fee');
  // ...
} finally {
  client.close();
}
```
</details>

## Watch for Changes

`ConfigWatcher` also supports `await using` for automatic stop + close:

```typescript
import { ConfigClient } from '@opendecree/sdk';

await using client = new ConfigClient('localhost:9090', { subject: 'myapp' });
await using watcher = client.watch('tenant-id');

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
// watcher.stop() + client.close() called automatically
```

## Examples

Runnable examples in the [`examples/`](examples/) directory:

| Example | What it shows |
|---------|--------------|
| [quickstart](examples/quickstart/) | `using` / `await using`, type converters (`Number`, `Boolean`) |
| [live-config](examples/live-config/) | `ConfigWatcher`, `.on('change')`, `for await...of` |
| [nextjs-integration](examples/nextjs-integration/) | Singleton watcher for server-side config |
| [error-handling](examples/error-handling/) | `RetryConfig`, `{ nullable: true }`, `instanceof` narrowing |

## Documentation

- 📖 [API Reference](https://opendecree.github.io/decree-typescript) -- full TypeDoc API reference
- [Quick Start](docs/quickstart.md) -- install, first get/set, typed gets, error handling
- [Configuration](docs/configuration.md) -- all client options, auth, TLS, retry, timeouts
- [Watching](docs/watching.md) -- ConfigWatcher, WatchedField, EventEmitter, async iteration

## Requirements

- Node.js 22+
- A running OpenDecree server (v0.8.0 – v0.x, pre-1.0)

## Questions?

Head to [OpenDecree Discussions](https://github.com/orgs/opendecree/discussions) -- our community hub covers all OpenDecree repos.

## License

Apache License 2.0 -- see [LICENSE](LICENSE).
