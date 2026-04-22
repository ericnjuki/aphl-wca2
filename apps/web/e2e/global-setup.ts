// Runs once before the Playwright test suite. Ensures the API is up and
// the admin user has a known password so login tests are deterministic.
//
// The API is NOT started here — we expect the user (or playwright.config's
// webServer) to be running it. globalSetup just primes fixtures.

import { resetAdminPassword } from './reset-admin-password';

async function globalSetup() {
  await resetAdminPassword();
}

export default globalSetup;
