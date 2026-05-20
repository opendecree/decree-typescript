import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { PROTO_VERSION, SUPPORTED_SERVER_VERSION, VERSION } from "../src/index.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

describe("version constants", () => {
	it("exports SDK version matching package.json", () => {
		expect(VERSION).toBe(pkg.version);
	});

	it("exports supported server version range", () => {
		expect(SUPPORTED_SERVER_VERSION).toBe(">=0.8.0,<1.0.0");
	});

	it("exports proto version", () => {
		expect(PROTO_VERSION).toBe("v1");
	});
});
