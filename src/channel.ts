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
 * - If `insecure` is true, returns insecure credentials (plaintext).
 * - Otherwise (default), returns TLS credentials.
 *
 * Logs a warning when plaintext is enabled with a token configured,
 * since the bearer token would be transmitted in cleartext.
 */
export function createChannel(options: ClientOptions): ChannelCredentials {
	const insecure = options.insecure ?? false;
	if (insecure) {
		if (options.token) {
			console.warn(
				"[decree] WARNING: insecure=true with a bearer token configured — " +
					"the token will be transmitted in cleartext. " +
					"Set insecure=false (or omit it) to use TLS.",
			);
		}
		return credentials.createInsecure();
	}
	const tls = options.tls;
	return credentials.createSsl(
		tls?.rootCerts ?? null,
		tls?.privateKey ?? null,
		tls?.certChain ?? null,
	);
}
