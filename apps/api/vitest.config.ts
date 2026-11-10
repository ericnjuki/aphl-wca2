import { defineConfig } from 'vitest/config';

// API integration tests. Each test file runs in its own module registry, so the
// sql.js singleton in src/db/database.ts is fresh per file; setup-env points it
// at a throwaway DB file.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup-env.ts'],
    pool: 'forks',
  },
});
