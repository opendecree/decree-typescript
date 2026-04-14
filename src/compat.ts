/**
 * Server version compatibility checking.
 *
 * Provides version parsing and constraint checking without external dependencies.
 */

import { IncompatibleServerError } from "./errors.js";
import { SUPPORTED_SERVER_VERSION } from "./index.js";

/**
 * Parse a semver-like version string into an array of numbers.
 *
 * Returns undefined if the version cannot be parsed (e.g., "dev").
 */
export function parseVersion(version: string): number[] | undefined {
	const match = version.match(/^v?(\d+(?:\.\d+)*)/);
	if (!match?.[1]) {
		return undefined;
	}
	return match[1].split(".").map(globalThis.Number);
}

/**
 * Check if a version satisfies a single constraint (e.g., ">=0.3.0", "<1.0.0").
 */
export function satisfies(version: number[], constraint: string): boolean {
	const match = constraint.match(/^(>=|<=|>|<|==|!=)(.+)$/);
	if (!match) {
		return true;
	}

	const op = match[1];
	const target = parseVersion(match[2] ?? "");
	if (target === undefined) {
		return true;
	}

	// Pad to same length for comparison.
	const maxLen = Math.max(version.length, target.length);
	const v = [...version, ...new Array<number>(maxLen - version.length).fill(0)];
	const t = [...target, ...new Array<number>(maxLen - target.length).fill(0)];

	const cmp = compare(v, t);

	switch (op) {
		case ">=":
			return cmp >= 0;
		case "<=":
			return cmp <= 0;
		case ">":
			return cmp > 0;
		case "<":
			return cmp < 0;
		case "==":
			return cmp === 0;
		case "!=":
			return cmp !== 0;
		default:
			return true;
	}
}

function compare(a: number[], b: number[]): number {
	for (let i = 0; i < a.length; i++) {
		const av = a[i] ?? 0;
		const bv = b[i] ?? 0;
		if (av < bv) return -1;
		if (av > bv) return 1;
	}
	return 0;
}

/**
 * Check that a server version satisfies the supported version range.
 *
 * @param serverVersion - Server version string (e.g., "0.3.1").
 * @param range - Version range (e.g., ">=0.3.0,<1.0.0"). Defaults to SUPPORTED_SERVER_VERSION.
 * @throws IncompatibleServerError if the server version is outside the supported range.
 */
export function checkVersionCompatible(serverVersion: string, range?: string): void {
	const supportedRange = range ?? SUPPORTED_SERVER_VERSION;

	const parsed = parseVersion(serverVersion);
	if (parsed === undefined) {
		// Can't parse (e.g., "dev") -- skip check.
		return;
	}

	for (const constraint of supportedRange.split(",")) {
		const trimmed = constraint.trim();
		if (!satisfies(parsed, trimmed)) {
			throw new IncompatibleServerError(
				`Server version ${serverVersion} is not compatible with this SDK (requires ${supportedRange})`,
			);
		}
	}
}
