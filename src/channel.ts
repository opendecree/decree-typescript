/**
 * gRPC channel credentials factory.
 *
 * Returns insecure or TLS credentials based on ClientOptions.
 */

import { type ChannelCredentials, credentials } from "@grpc/grpc-js";
import type { ClientOptions } from "./types.js";

/**
 * Create gRPC channel credentials based on client options.
 *
 * - If `insecure` is true (default), returns insecure credentials (plaintext).
 * - Otherwise, returns TLS credentials.
 */
export function createChannel(options: ClientOptions): ChannelCredentials {
	const insecure = options.insecure ?? true;
	if (insecure) {
		return credentials.createInsecure();
	}
	return credentials.createSsl();
}
