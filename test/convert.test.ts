import { describe, expect, it } from "vitest";
import { convertValue, typedValueToString } from "../src/convert.js";
import { TypeMismatchError } from "../src/errors.js";
import type { TypedValue } from "../src/generated/centralconfig/v1/types.js";

describe("convertValue", () => {
	describe("String converter", () => {
		it("returns the raw string", () => {
			expect(convertValue("hello", String)).toBe("hello");
		});

		it("returns empty string", () => {
			expect(convertValue("", String)).toBe("");
		});
	});

	describe("Number converter", () => {
		it("converts integer strings", () => {
			expect(convertValue("42", Number)).toBe(42);
		});

		it("converts negative numbers", () => {
			expect(convertValue("-7", Number)).toBe(-7);
		});

		it("converts float strings", () => {
			expect(convertValue("3.14", Number)).toBe(3.14);
		});

		it("converts zero", () => {
			expect(convertValue("0", Number)).toBe(0);
		});

		it("throws TypeMismatchError for non-numeric strings", () => {
			expect(() => convertValue("abc", Number)).toThrow(TypeMismatchError);
		});

		it("throws TypeMismatchError for empty string", () => {
			expect(() => convertValue("", Number)).toThrow(TypeMismatchError);
		});
	});

	describe("Boolean converter", () => {
		it("converts 'true' to true", () => {
			expect(convertValue("true", Boolean)).toBe(true);
		});

		it("converts 'TRUE' to true (case insensitive)", () => {
			expect(convertValue("TRUE", Boolean)).toBe(true);
		});

		it("converts '1' to true", () => {
			expect(convertValue("1", Boolean)).toBe(true);
		});

		it("converts 'false' to false", () => {
			expect(convertValue("false", Boolean)).toBe(false);
		});

		it("converts 'FALSE' to false (case insensitive)", () => {
			expect(convertValue("FALSE", Boolean)).toBe(false);
		});

		it("converts '0' to false", () => {
			expect(convertValue("0", Boolean)).toBe(false);
		});

		it("throws TypeMismatchError for invalid boolean strings", () => {
			expect(() => convertValue("yes", Boolean)).toThrow(TypeMismatchError);
		});
	});
});

describe("typedValueToString", () => {
	it("returns empty string for undefined", () => {
		expect(typedValueToString(undefined)).toBe("");
	});

	it("converts integerValue", () => {
		const tv: TypedValue = { integerValue: 42 };
		expect(typedValueToString(tv)).toBe("42");
	});

	it("converts numberValue", () => {
		const tv: TypedValue = { numberValue: 3.14 };
		expect(typedValueToString(tv)).toBe("3.14");
	});

	it("converts stringValue", () => {
		const tv: TypedValue = { stringValue: "hello" };
		expect(typedValueToString(tv)).toBe("hello");
	});

	it("converts boolValue true", () => {
		const tv: TypedValue = { boolValue: true };
		expect(typedValueToString(tv)).toBe("true");
	});

	it("converts boolValue false", () => {
		const tv: TypedValue = { boolValue: false };
		expect(typedValueToString(tv)).toBe("false");
	});

	it("converts timeValue", () => {
		const tv: TypedValue = { timeValue: new Date("2025-01-15T09:30:00Z") };
		expect(typedValueToString(tv)).toBe("2025-01-15T09:30:00.000Z");
	});

	it("converts durationValue in hours", () => {
		const tv: TypedValue = { durationValue: { seconds: 7200, nanos: 0 } };
		expect(typedValueToString(tv)).toBe("2h");
	});

	it("converts durationValue in minutes", () => {
		const tv: TypedValue = { durationValue: { seconds: 1800, nanos: 0 } };
		expect(typedValueToString(tv)).toBe("30m");
	});

	it("converts durationValue in seconds", () => {
		const tv: TypedValue = { durationValue: { seconds: 45, nanos: 0 } };
		expect(typedValueToString(tv)).toBe("45s");
	});

	it("converts zero duration", () => {
		const tv: TypedValue = { durationValue: { seconds: 0, nanos: 0 } };
		expect(typedValueToString(tv)).toBe("0s");
	});

	it("converts durationValue with nanos", () => {
		const tv: TypedValue = { durationValue: { seconds: 1, nanos: 500_000_000 } };
		expect(typedValueToString(tv)).toBe("1.5s");
	});

	it("converts urlValue", () => {
		const tv: TypedValue = { urlValue: "https://example.com" };
		expect(typedValueToString(tv)).toBe("https://example.com");
	});

	it("converts jsonValue", () => {
		const tv: TypedValue = { jsonValue: '{"key":"value"}' };
		expect(typedValueToString(tv)).toBe('{"key":"value"}');
	});

	it("returns empty string for empty TypedValue", () => {
		const tv: TypedValue = {};
		expect(typedValueToString(tv)).toBe("");
	});
});
