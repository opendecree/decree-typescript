import { defineProject } from "vitest/config";

const active = process.env.DECREE_INTEGRATION === "1";

export default defineProject({
	test: {
		name: "integration",
		include: active ? ["./integration/suite.test.ts"] : [],
		globalSetup: active ? ["./integration/setup.ts"] : [],
		testTimeout: 30_000,
		hookTimeout: 30_000,
	},
});
