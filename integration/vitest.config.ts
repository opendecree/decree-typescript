import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "integration",
		include: ["./integration/suite.test.ts"],
		globalSetup: ["./integration/setup.ts"],
		testTimeout: 30_000,
		hookTimeout: 30_000,
	},
});
