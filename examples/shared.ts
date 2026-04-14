/**
 * Shared utilities for examples.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Read the tenant ID from TENANT_ID env var or ../.tenant-id file.
 */
export function getTenantId(): string {
  const envVal = process.env["TENANT_ID"];
  if (envVal) {
    return envVal;
  }

  try {
    return readFileSync(resolve(__dirname, ".tenant-id"), "utf-8").trim();
  } catch {
    console.error("Set TENANT_ID env var or run 'make setup' from the examples directory");
    process.exit(1);
  }
}
