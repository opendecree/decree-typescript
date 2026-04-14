# Next.js Integration

Live configuration in API route handlers using a singleton `ConfigWatcher`.

## What it shows

- Singleton watcher pattern for server-side config (Next.js / Node.js servers)
- `field.value` in route handlers — always fresh, no polling
- Separate endpoints for server config and feature flags
- gRPC is Node.js only — decree runs server-side, not in the browser

## Pattern for Next.js

```
lib/config.ts          → singleton watcher, exports watched fields
app/api/config/route.ts → reads field.value in GET handler
app/api/features/route.ts → reads field.value in GET handler
```

## Run

```bash
cd examples
npm install
npx tsx nextjs-integration/main.ts
```

Then:
```bash
curl http://localhost:3001/api/config
curl http://localhost:3001/api/features
```

Change a value and refresh:
```bash
decree config set <tenant-id> features.dark_mode false
curl http://localhost:3001/api/features
```

## Next

- [error-handling](../error-handling/) — retry, nullable, error hierarchy

## Learn more

- [Next.js docs](https://nextjs.org/docs)
- [@opendecree/sdk on npm](https://www.npmjs.com/package/@opendecree/sdk)
