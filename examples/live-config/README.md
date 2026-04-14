# Live Config

Watch configuration values change in real time using `ConfigWatcher`.

## What it shows

- `client.watch()` to create a watcher
- `watcher.field()` with type converters and defaults
- `.on('change')` EventEmitter pattern for reactive callbacks
- `for await...of` async iteration over field changes
- `field.value` for reading the current value at any time

## Run

```bash
cd examples
npm install
npx tsx live-config/main.ts
```

Then in another terminal:
```bash
decree config set <tenant-id> server.rate_limit 500
```

## Next

- [nextjs-integration](../nextjs-integration/) — watcher in a web server
- [error-handling](../error-handling/) — retry, nullable, error hierarchy

## Learn more

- [@opendecree/sdk on npm](https://www.npmjs.com/package/@opendecree/sdk)
