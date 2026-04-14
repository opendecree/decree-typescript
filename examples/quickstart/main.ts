/**
 * Quickstart: connect to OpenDecree and read typed configuration values.
 *
 * This is the simplest possible example — type converters, Symbol.dispose.
 *
 * Run:
 *   npx tsx quickstart/main.ts
 *
 * Requires a running decree server with seeded data (see ../README.md).
 */

import { ConfigClient } from "@opendecree/sdk";
import { getTenantId } from "../shared.js";

async function main(): Promise<void> {
  const tenantId = getTenantId();
  const client = new ConfigClient("localhost:9090", { subject: "quickstart-example" });

  try {
    // get() returns string by default.
    const name = await client.get(tenantId, "app.name");
    console.log(`app.name:          ${name}`);

    // Pass a type converter for typed values.
    const debug = await client.get(tenantId, "app.debug", Boolean);
    console.log(`app.debug:         ${debug}`);

    const rateLimit = await client.get(tenantId, "server.rate_limit", Number);
    console.log(`server.rate_limit: ${rateLimit}`);

    const feeRate = await client.get(tenantId, "payments.fee_rate", Number);
    console.log(`payments.fee_rate: ${feeRate}`);

    // set() and setMany() for writes.
    await client.set(tenantId, "app.debug", "true");
    console.log("\nSet app.debug = true");

    const updated = await client.get(tenantId, "app.debug", Boolean);
    console.log(`app.debug:         ${updated}`);
  } finally {
    client.close();
  }
}

main().catch(console.error);
