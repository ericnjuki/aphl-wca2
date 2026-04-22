import { defineConfig, devices } from '@playwright/test';

// Use 127.0.0.1 for Playwright's health check so the `url:` probe doesn't
// care whether Node resolves localhost to IPv4 or IPv6. Vite itself listens
// on all interfaces (server.host: true). Port is hard-coded to 5573 in
// vite.config.ts (strictPort) so we never silently land on a neighbour port.
const WEB_URL = 'http://127.0.0.1:5573';

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,       // tests mutate shared db state; keep serial
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },

  globalSetup: './e2e/global-setup.ts',

  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Auto-start the web dev server. The API must already be running
  // (run `pnpm dev:api` from repo root) — starting both from Playwright
  // on Windows is fragile, so we keep it simple.
  //
  // Vite proxies /api → backend, so there's no VITE_API_URL override here
  // and nothing special about the host: both `localhost` and `127.0.0.1`
  // reach the same app (server.host: true in vite.config.ts).
  webServer: {
    command: 'pnpm run dev',
    url: WEB_URL,
    reuseExistingServer: true,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
