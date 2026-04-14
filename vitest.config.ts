import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/generated/**", "src/index.ts", "src/types.ts"],
			thresholds: {
				statements: 95,
			},
		},
	},
});
