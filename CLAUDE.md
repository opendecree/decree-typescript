# OpenDecree TypeScript SDK — Claude Context

## Overview

TypeScript SDK for the OpenDecree configuration service. Wraps the gRPC API with a typed
client, field-watching subscriptions, version compatibility checks, and optional JWT rotation.

## Tech Stack

| Concern | Tool |
|---------|------|
| Language | TypeScript (strict) |
| Runtime | Node.js 22+ |
| Transport | @grpc/grpc-js |
| Code generation | ts-proto via buf (Docker) |
| Lint / format | Biome |
| Tests | Vitest |
| Build | tsc |

## Development

### Prerequisites

Node.js 22+, Docker (for proto generation), npm.

### Key Commands

```bash
npm run generate        # regenerate proto stubs (buf + Docker)
npm run pre-commit      # biome check + typecheck + unit tests
npm run test            # vitest run (unit)
npm run test:integration # integration tests against live server
npm run build           # tsc emit to dist/
```

### Layout

```
src/
├── generated/    # generated proto stubs (committed)
├── client.ts     # ConfigClient
├── watcher.ts    # ConfigWatcher
├── compat.ts     # server version checks
└── ...
test/             # unit tests
integration/      # integration tests (live server)
```

## Coding Guidelines

See [coding-guidelines.md](https://github.com/opendecree/decree/blob/main/docs/development/coding-guidelines.md)
for the shared philosophy (vanilla principle, minimal deps) and the TypeScript-specific section
(zero runtime deps beyond grpc-js, strict TS flags, Biome enforcement).

## Conventions

- Only runtime dependency: `@grpc/grpc-js`
- Generated proto stubs committed under `src/generated/`
- `SUPPORTED_SERVER_VERSION` generated from `package.json` via `scripts/gen-version.mjs`
- Apache 2.0 license
