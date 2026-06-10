import { defineConfig } from "vitest/config";

// Pure-logic unit tests only (no DOM). Survey builders return strings/objects,
// so the default node environment is sufficient — no jsdom needed.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
