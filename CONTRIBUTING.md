# Contributing to OpenDecree TypeScript SDK

Thank you for your interest in contributing! This guide covers how to set up your development environment, build, test, and submit changes.

## Prerequisites

- **Node.js** (20+)
- **npm** (included with Node.js)
- **Docker** (for proto generation only)

## Getting Started

```bash
# Clone the repository
git clone https://github.com/opendecree/decree-typescript.git
cd decree-typescript

# Install dependencies
npm install

# Run the full check suite
npm run lint && npm run typecheck && npm test
```

## Development Cycle

```
edit code -> lint -> typecheck -> test -> commit -> PR
```

### npm Scripts

| Script | Description |
|--------|-------------|
| `npm run generate` | Regenerate proto stubs from `.proto` files |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run lint` | Lint with Biome |
| `npm run format` | Auto-format with Biome |
| `npm run typecheck` | Type check with `tsc --noEmit` |
| `npm test` | Run tests with Vitest |
| `npm run test:coverage` | Run tests with coverage report |

### Proto Stubs

Generated proto stubs live in `src/generated/` and are committed to git. If the upstream `.proto` files change, regenerate with:

```bash
npm run generate
```

## Project Structure

```
src/
├── index.ts              # Public exports
├── client.ts             # ConfigClient (promise-based)
├── watcher.ts            # ConfigWatcher + WatchedField
├── errors.ts             # Error hierarchy
├── types.ts              # Public interfaces
├── channel.ts            # gRPC channel factory
├── convert.ts            # TypedValue conversion
├── retry.ts              # Exponential backoff retry
├── compat.ts             # Server version compatibility
└── generated/            # Proto stubs (committed)
test/
├── client.test.ts        # ConfigClient tests
├── watcher.test.ts       # ConfigWatcher + WatchedField tests
├── errors.test.ts        # Error mapping tests
├── convert.test.ts       # Value conversion tests
├── retry.test.ts         # Retry logic tests
└── compat.test.ts        # Version compatibility tests
docs/                     # Usage documentation
```

## Testing

```bash
npm test
```

Tests use Vitest. Coverage is measured with `@vitest/coverage-v8`. Tests mock gRPC stubs -- no running server needed.

```bash
# Run with coverage
npm run test:coverage

# Watch mode during development
npm run test:watch
```

## Code Style

- **Linting and formatting**: [Biome](https://biomejs.dev/)
- **Type checking**: TypeScript in strict mode
- Run `npm run lint && npm run typecheck` before submitting

## Submitting Changes

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Ensure `npm run lint && npm run typecheck && npm test` passes
5. Open a pull request against `main`

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
