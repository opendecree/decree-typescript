/**
 * Type conversion between proto TypedValue and native TypeScript types.
 *
 * The server stores all values internally as strings. The SDK converts
 * between the proto TypedValue representation and native types at the boundary.
 */

import { TypeMismatchError } from "./errors.js";
import type { TypedValue } from "./generated/centralconfig/v1/types.js";

/** Runtime converter type — pass String, Number, or Boolean to get(). */
export type Converter = typeof String | typeof Number | typeof Boolean;

/**
 * Convert a raw string value to the target type.
 *
 * @param raw - The raw string value from the server.
 * @param type - The target type constructor (String, Number, Boolean).
 * @returns The converted value.
 * @throws TypeMismatchError if the value cannot be converted.
 */
export function convertValue(raw: string, type: Converter): unknown {
	if (type === String) {
		return raw;
	}
	if (type === Number) {
		if (raw.trim() === "") {
			throw new TypeMismatchError(`cannot convert ${JSON.stringify(raw)} to number`);
		}
		const n = globalThis.Number(raw);
		if (globalThis.Number.isNaN(n)) {
			throw new TypeMismatchError(`cannot convert ${JSON.stringify(raw)} to number`);
		}
		return n;
	}
	if (type === Boolean) {
		const lower = raw.toLowerCase();
		if (lower === "true" || lower === "1") {
			return true;
		}
		if (lower === "false" || lower === "0") {
			return false;
		}
		throw new TypeMismatchError(`cannot convert ${JSON.stringify(raw)} to boolean`);
	}
	throw new TypeMismatchError("unsupported converter type");
}

/**
 * Extract the string representation from a proto TypedValue.
 *
 * The TypedValue oneof has 8 variants (integerValue, numberValue,
 * stringValue, boolValue, timeValue, durationValue, urlValue, jsonValue).
 * Each is converted to its canonical string form.
 *
 * @returns The string representation, or empty string for null/empty values.
 */
export function typedValueToString(tv: TypedValue | undefined): string {
	if (tv === undefined) {
		return "";
	}
	if (tv.integerValue !== undefined) {
		return String(tv.integerValue);
	}
	if (tv.numberValue !== undefined) {
		return String(tv.numberValue);
	}
	if (tv.stringValue !== undefined) {
		return tv.stringValue;
	}
	if (tv.boolValue !== undefined) {
		return tv.boolValue ? "true" : "false";
	}
	if (tv.timeValue !== undefined) {
		// timeValue is a Date from ts-proto
		return tv.timeValue.toISOString();
	}
	if (tv.durationValue !== undefined) {
		// durationValue has seconds and nanos
		const dur = tv.durationValue;
		const seconds = Number(dur.seconds ?? 0);
		const nanos = dur.nanos ?? 0;
		const totalNs = seconds * 1_000_000_000 + nanos;
		if (totalNs === 0) {
			return "0s";
		}
		const totalS = Math.floor(totalNs / 1_000_000_000);
		const remainderNs = totalNs % 1_000_000_000;
		if (remainderNs === 0) {
			if (totalS >= 3600 && totalS % 3600 === 0) {
				return `${totalS / 3600}h`;
			}
			if (totalS >= 60 && totalS % 60 === 0) {
				return `${totalS / 60}m`;
			}
			return `${totalS}s`;
		}
		return `${totalNs / 1_000_000_000}s`;
	}
	if (tv.urlValue !== undefined) {
		return tv.urlValue;
	}
	if (tv.jsonValue !== undefined) {
		return tv.jsonValue;
	}
	return "";
}
