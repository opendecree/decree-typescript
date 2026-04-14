/**
 * Live Config: watch configuration values change in real time.
 *
 * Demonstrates ConfigWatcher with EventEmitter and async iteration.
 * Run this, then change values with the decree CLI and watch the output update.
 *
 * Run:
 *   npx tsx live-config/main.ts
 *
 * Requires a running decree server with seeded data (see ../README.md).
 */

import { ConfigClient } from "@opendecree/sdk";
import { getTenantId } from "../shared.js";

async function main(): Promise<void> {
  const tenantId = getTenantId();
  const client = new ConfigClient("localhost:9090", { subject: "live-config-example" });

  const watcher = client.watch(tenantId);

  // Register fields with type converters and defaults.
  const rateLimit = watcher.field("server.rate_limit", Number, { default: 100 });
  const debug = watcher.field("app.debug", Boolean, { default: false });
  const darkMode = watcher.field("features.dark_mode", Boolean, { default: false });

  // EventEmitter pattern — react to changes with .on('change').
  rateLimit.on("change", (oldVal: number, newVal: number) => {
    console.log(`  [event] rate_limit: ${oldVal} → ${newVal}`);
  });

  debug.on("change", (oldVal: boolean, newVal: boolean) => {
    console.log(`  [event] debug: ${oldVal} → ${newVal}`);
  });

  // Start loads the snapshot and opens the subscription stream.
  await watcher.start();

  console.log("Current values:");
  console.log(`  server.rate_limit: ${rateLimit.value}`);
  console.log(`  app.debug:         ${debug.value}`);
  console.log(`  features.dark_mode: ${darkMode.value}`);
  console.log();
  console.log("Watching for changes... (Ctrl+C to stop)");
  console.log("Try: decree config set <tenant-id> server.rate_limit 500");

  // Async iteration — for await...of yields Change objects.
  process.on("SIGINT", async () => {
    await watcher.stop();
    client.close();
    process.exit(0);
  });

  for await (const change of rateLimit) {
    console.log(`  [change] ${change.fieldPath}: ${change.oldValue} → ${change.newValue}`);
  }
}

main().catch(console.error);
