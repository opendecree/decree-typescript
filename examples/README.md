# OpenDecree TypeScript SDK Examples

Runnable examples demonstrating the OpenDecree TypeScript SDK.

## Setup

Start the decree server and seed example data:

```bash
# From this directory
make setup
```

This starts PostgreSQL, Redis, and the decree server via Docker Compose,
then creates an example schema, tenant, and initial config values.

The tenant ID is written to `.tenant-id` — examples read it automatically.

## Prerequisites

```bash
npm install
```

Examples use [tsx](https://github.com/privatenumber/tsx) to run TypeScript directly:

```bash
npm install -g tsx
```

## Examples

| Example | What it shows | Server required |
|---------|--------------|-----------------|
| [quickstart](quickstart/) | Type converters (`Number`, `Boolean`), try/finally | Yes |
| [live-config](live-config/) | `ConfigWatcher`, `.on('change')`, `for await...of` | Yes |
| [nextjs-integration](nextjs-integration/) | Singleton watcher pattern for server-side config | Yes |
| [error-handling](error-handling/) | `RetryConfig`, `{ nullable: true }`, `instanceof` narrowing | Yes |

## Running an example

```bash
# After make setup:
npx tsx quickstart/main.ts
```

## Teardown

```bash
make down
```

## Learn more

- [@opendecree/sdk on npm](https://www.npmjs.com/package/@opendecree/sdk)
- [OpenDecree docs](https://github.com/opendecree/decree)
