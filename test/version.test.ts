import { describe, expect, it } from "vitest";
import { PROTO_VERSION, SUPPORTED_SERVER_VERSION, VERSION } from "../src/index.js";

describe("version constants", () => {
	it("exports SDK version", () => {
		expect(VERSION).toBe("0.1.0");
	});

	it("exports supported server version range", () => {
		expect(SUPPORTED_SERVER_VERSION).toBe(">=0.3.0,<1.0.0");
	});

	it("exports proto version", () => {
		expect(PROTO_VERSION).toBe("v1");
	});
});
