import { describe, expect, it } from "vitest";
import { checkVersionCompatible, parseVersion, satisfies } from "../src/compat.js";
import { IncompatibleServerError } from "../src/errors.js";

describe("parseVersion", () => {
	it("parses simple semver", () => {
		expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
	});

	it("parses version with v prefix", () => {
		expect(parseVersion("v0.3.1")).toEqual([0, 3, 1]);
	});

	it("parses two-part version", () => {
		expect(parseVersion("1.0")).toEqual([1, 0]);
	});

	it("parses single number", () => {
		expect(parseVersion("3")).toEqual([3]);
	});

	it("parses version with prerelease suffix (ignores suffix)", () => {
		expect(parseVersion("1.2.3-beta.1")).toEqual([1, 2, 3]);
	});

	it("returns undefined for non-numeric versions", () => {
		expect(parseVersion("dev")).toBeUndefined();
	});

	it("returns undefined for empty string", () => {
		expect(parseVersion("")).toBeUndefined();
	});
});

describe("satisfies", () => {
	it("checks >= constraint", () => {
		expect(satisfies([0, 3, 0], ">=0.3.0")).toBe(true);
		expect(satisfies([0, 3, 1], ">=0.3.0")).toBe(true);
		expect(satisfies([0, 2, 9], ">=0.3.0")).toBe(false);
	});

	it("checks < constraint", () => {
		expect(satisfies([0, 9, 0], "<1.0.0")).toBe(true);
		expect(satisfies([1, 0, 0], "<1.0.0")).toBe(false);
	});

	it("checks > constraint", () => {
		expect(satisfies([0, 4, 0], ">0.3.0")).toBe(true);
		expect(satisfies([0, 3, 0], ">0.3.0")).toBe(false);
	});

	it("checks <= constraint", () => {
		expect(satisfies([0, 3, 0], "<=0.3.0")).toBe(true);
		expect(satisfies([0, 3, 1], "<=0.3.0")).toBe(false);
	});

	it("checks == constraint", () => {
		expect(satisfies([0, 3, 0], "==0.3.0")).toBe(true);
		expect(satisfies([0, 3, 1], "==0.3.0")).toBe(false);
	});

	it("checks != constraint", () => {
		expect(satisfies([0, 3, 0], "!=0.3.0")).toBe(false);
		expect(satisfies([0, 3, 1], "!=0.3.0")).toBe(true);
	});

	it("returns true for unparseable constraint", () => {
		expect(satisfies([0, 3, 0], "foo")).toBe(true);
	});

	it("returns true for unparseable target version in constraint", () => {
		expect(satisfies([0, 3, 0], ">=dev")).toBe(true);
	});

	it("pads versions to same length", () => {
		expect(satisfies([1], ">=1.0.0")).toBe(true);
		expect(satisfies([1, 0, 0], ">=1")).toBe(true);
	});

	it("compare ?? 0 guard: sparse array makes a[i] undefined, triggering nullish coalescing", () => {
		// compare() uses `a[i] ?? 0` and `b[i] ?? 0` as defensive guards.
		// These are only reachable if the array has holes (undefined slots).
		// Spreading a sparse array into [...version, ...fill] preserves undefined holes,
		// so a[i] can be undefined inside compare().
		const sparseVersion = [1] as number[];
		sparseVersion.length = 3; // [1, <empty>, <empty>] — sparse array with holes
		// satisfies pads via [...sparseVersion, ...fill]; spread of sparse keeps undefined slots.
		// compare() then hits a[1] ?? 0 → 0, triggering the right-hand side of ??.
		expect(satisfies(sparseVersion, ">=1.0.0")).toBe(true); // [1,0,0] >= [1,0,0]
		expect(satisfies(sparseVersion, ">=1.0.1")).toBe(false); // [1,0,0] < [1,0,1]
	});

	// NOTE: The `default: return true` branch at line 59 of compat.ts is unreachable
	// via normal string input. The regex /^(>=|<=|>|<|==|!=)(.+)$/ only matches
	// those 6 operators, so `op` is always one of them when the switch is reached.
	// There is no safe non-destructive way to reach it without monkeypatching
	// String.prototype.match, which would be too fragile for a unit test suite.
});

describe("checkVersionCompatible", () => {
	it("passes for compatible version", () => {
		expect(() => checkVersionCompatible("0.3.0", ">=0.3.0,<1.0.0")).not.toThrow();
	});

	it("passes for version in range", () => {
		expect(() => checkVersionCompatible("0.5.2", ">=0.3.0,<1.0.0")).not.toThrow();
	});

	it("throws IncompatibleServerError for version below range", () => {
		expect(() => checkVersionCompatible("0.2.0", ">=0.3.0,<1.0.0")).toThrow(
			IncompatibleServerError,
		);
	});

	it("throws IncompatibleServerError for version above range", () => {
		expect(() => checkVersionCompatible("1.0.0", ">=0.3.0,<1.0.0")).toThrow(
			IncompatibleServerError,
		);
	});

	it("skips check for unparseable version (e.g., dev)", () => {
		expect(() => checkVersionCompatible("dev", ">=0.3.0,<1.0.0")).not.toThrow();
	});

	it("uses default SUPPORTED_SERVER_VERSION when range is omitted", () => {
		// 0.8.0 should be in >=0.8.0,<1.0.0
		expect(() => checkVersionCompatible("0.8.0")).not.toThrow();
	});

	it("includes version info in error message", () => {
		try {
			checkVersionCompatible("0.1.0", ">=0.3.0,<1.0.0");
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(IncompatibleServerError);
			expect((err as Error).message).toContain("0.1.0");
			expect((err as Error).message).toContain(">=0.3.0,<1.0.0");
		}
	});
});
