# Error Handling

Retry configuration, nullable fields, and the typed error hierarchy.

## What it shows

- `RetryConfig` — customize retry attempts, backoff, and max delay
- `{ nullable: true }` — returns `T | null` for missing values instead of throwing
- `setNull()` — explicitly null a field
- `instanceof` narrowing: `NotFoundError`, `InvalidArgumentError`, `DecreeError`
- Disabling retry with `retry: false`

## Run

```bash
cd examples
npm install
npx tsx error-handling/main.ts
```

## Error types

| Exception | When |
|-----------|------|
| `NotFoundError` | Field or tenant doesn't exist |
| `InvalidArgumentError` | Value fails schema validation |
| `LockedError` | Field is locked |
| `ChecksumMismatchError` | Optimistic concurrency conflict |
| `PermissionDeniedError` | Auth failure |
| `UnavailableError` | Server unreachable (retryable) |
| `TypeMismatchError` | SDK can't convert value to requested type |
| `DecreeError` | Base class for all of the above |

## Learn more

- [@opendecree/sdk on npm](https://www.npmjs.com/package/@opendecree/sdk)
