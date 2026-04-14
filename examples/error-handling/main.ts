/**
 * Error Handling: retry configuration, nullable fields, and error hierarchy.
 *
 * Demonstrates TypeScript-specific patterns for robust config access:
 * - RetryConfig for transient failure recovery
 * - nullable option with union types (T | null)
 * - instanceof narrowing for precise error handling
 *
 * Run:
 *   npx tsx error-handling/main.ts
 *
 * Requires a running decree server with seeded data (see ../README.md).
 */

import {
  ConfigClient,
  DecreeError,
  InvalidArgumentError,
  NotFoundError,
} from "@opendecree/sdk";
import { getTenantId } from "../shared.js";

async function main(): Promise<void> {
  const tenantId = getTenantId();

  // --- Custom retry configuration ---
  const client = new ConfigClient("localhost:9090", {
    subject: "error-example",
    retry: {
      maxAttempts: 5,
      initialBackoff: 200,
      maxBackoff: 10_000,
    },
  });

  try {
    // --- Nullable reads ---
    // Without nullable, missing values throw NotFoundError.
    // With { nullable: true }, they return null instead.
    console.log("=== Nullable reads ===");
    const value = await client.get(tenantId, "app.name", String, { nullable: true });
    console.log(`app.name (exists):           ${JSON.stringify(value)}`);

    // setNull makes a field return null with nullable.
    await client.setNull(tenantId, "app.debug");
    const nulled = await client.get(tenantId, "app.debug", String, { nullable: true });
    console.log(`app.debug (after setNull):   ${JSON.stringify(nulled)}`);

    // Restore it.
    await client.set(tenantId, "app.debug", "false");
    const restored = await client.get(tenantId, "app.debug", Boolean);
    console.log(`app.debug (restored):        ${JSON.stringify(restored)}`);

    // --- Error hierarchy with instanceof narrowing ---
    console.log("\n=== Error hierarchy ===");

    // NotFoundError — field doesn't exist.
    try {
      await client.get(tenantId, "nonexistent.field");
    } catch (err) {
      if (err instanceof NotFoundError) {
        console.log(`NotFoundError:        ${err.message}`);
      }
    }

    // InvalidArgumentError — value fails validation.
    try {
      await client.set(tenantId, "server.rate_limit", "-1");
    } catch (err) {
      if (err instanceof InvalidArgumentError) {
        console.log(`InvalidArgumentError: ${err.message}`);
      }
    }

    // All decree errors share a common base class.
    try {
      await client.get(tenantId, "nonexistent.field");
    } catch (err) {
      if (err instanceof DecreeError) {
        console.log(`DecreeError base:     ${err.constructor.name}: ${err.message}`);
      }
    }

    // --- Retry behavior ---
    console.log("\n=== Retry ===");
    console.log("Configured: 5 attempts, 200ms initial backoff, 10s max backoff");
    console.log("Retries are automatic on UNAVAILABLE and DEADLINE_EXCEEDED.");

    // To disable retry entirely, pass retry: false.
    const noRetryClient = new ConfigClient("localhost:9090", {
      subject: "no-retry-example",
      retry: false,
    });
    try {
      const val = await noRetryClient.get(tenantId, "app.name");
      console.log(`No-retry read:       ${JSON.stringify(val)}`);
    } finally {
      noRetryClient.close();
    }
  } finally {
    client.close();
  }
}

main().catch(console.error);
