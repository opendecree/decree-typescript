import { defineWorkspace } from "vitest/config";

// Unit tests only. Integration tests run separately via:
//   DECREE_INTEGRATION=1 npm run test:integration
export default defineWorkspace(["./vitest.config.ts"]);
