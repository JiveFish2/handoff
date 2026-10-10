import path from "node:path";
import { defineConfig } from "vitest/config";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://handoff:handoff@localhost:5434/handoff_test";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    globalSetup: "./tests/setup-db.ts",
    env: { TEST_DATABASE_URL },
    // The integration tests share one database; run files one at a time.
    fileParallelism: false,
  },
});
