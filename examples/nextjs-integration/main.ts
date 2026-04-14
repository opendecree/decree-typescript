/**
 * Next.js Integration: live config in API route handlers.
 *
 * This example shows the pattern for using OpenDecree in a Next.js app.
 * Since @grpc/grpc-js is Node.js only, decree runs server-side:
 * - Singleton ConfigWatcher initialized once on cold start
 * - Route handlers read field.value synchronously (always fresh)
 *
 * This file demonstrates the pattern as a standalone HTTP server.
 * In a real Next.js app, the singleton goes in lib/config.ts and
 * route handlers import the watched fields.
 *
 * Run:
 *   npx tsx nextjs-integration/main.ts
 *
 * Then visit http://localhost:3001/api/config or http://localhost:3001/api/features.
 *
 * Requires a running decree server with seeded data (see ../README.md).
 */

import { createServer } from "node:http";
import { ConfigClient, type ConfigWatcher, type WatchedField } from "@opendecree/sdk";
import { getTenantId } from "../shared.js";

// --- lib/config.ts (in a real Next.js app) ---

let watcher: ConfigWatcher;
let client: ConfigClient;

// Watched fields — exported for use in route handlers.
let rateLimit: WatchedField<number>;
let timeout: WatchedField<string>;
let debug: WatchedField<boolean>;
let darkMode: WatchedField<boolean>;
let betaAccess: WatchedField<boolean>;

async function initConfig(): Promise<void> {
  const tenantId = getTenantId();
  client = new ConfigClient("localhost:9090", { subject: "nextjs-example" });
  watcher = client.watch(tenantId);

  rateLimit = watcher.field("server.rate_limit", Number, { default: 100 });
  timeout = watcher.field("server.timeout", String, { default: "30s" });
  debug = watcher.field("app.debug", Boolean, { default: false });
  darkMode = watcher.field("features.dark_mode", Boolean, { default: false });
  betaAccess = watcher.field("features.beta_access", Boolean, { default: false });

  await watcher.start();
}

// --- app/api/config/route.ts ---

function handleConfig(): string {
  return JSON.stringify(
    {
      rate_limit: rateLimit.value,
      timeout: timeout.value,
      debug: debug.value,
    },
    null,
    2,
  );
}

// --- app/api/features/route.ts ---

function handleFeatures(): string {
  return JSON.stringify(
    {
      dark_mode: darkMode.value,
      beta_access: betaAccess.value,
    },
    null,
    2,
  );
}

// --- Standalone server (simulates Next.js) ---

async function main(): Promise<void> {
  await initConfig();

  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");

    if (req.url === "/api/config") {
      res.end(handleConfig());
    } else if (req.url === "/api/features") {
      res.end(handleFeatures());
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not found" }));
    }
  });

  server.listen(3001, () => {
    console.log("Listening on http://localhost:3001");
    console.log("  GET /api/config   — server config (live)");
    console.log("  GET /api/features — feature flags (live)");
    console.log();
    console.log("Config updates are live — change values and refresh.");
  });

  process.on("SIGINT", async () => {
    server.close();
    await watcher.stop();
    client.close();
    process.exit(0);
  });
}

main().catch(console.error);
