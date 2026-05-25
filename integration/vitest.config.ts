import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "integration",
		include: ["./suite.test.ts"],
		globalSetup: ["./setup.ts"],
		testTimeout: 30_000,
		hookTimeout: 30_000,
	},
});
