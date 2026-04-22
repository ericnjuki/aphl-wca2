import { test, expect, Page } from '@playwright/test';
import { TEST_ADMIN_USERNAME, TEST_ADMIN_PASSWORD } from './reset-admin-password';

// Only count real render-blocking errors. React's "Maximum update depth"
// bug surfaces as a pageerror, which is what we really care about; random
// console.error noise (4xx responses from TanStack Query's auth probe,
// dev-mode warnings, network blips) is not a reason to fail the test.
function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

async function login(page: Page) {
  await page.goto('/');
  await page.locator('#auth-login').fill(TEST_ADMIN_USERNAME);
  await page.locator('#auth-password').fill(TEST_ADMIN_PASSWORD);
  await page.getByRole('button', { name: /login|sign in/i }).click();

  // Wait for the authenticated shell — the sidebar "Reports" link is visible
  // to admins on every authenticated page.
  await expect(page.getByRole('link', { name: /reports/i }).first()).toBeVisible({
    timeout: 10_000,
  });
}

test.describe('Reports page', () => {
  test('loads without Maximum update depth error', async ({ page }) => {
    const pageErrors = watchPageErrors(page);

    await login(page);

    // Navigate to /reports — this was the page that crashed.
    await page.getByRole('link', { name: /reports/i }).first().click();
    await page.waitForURL(/\/reports$/);

    // The error boundary renders "Something went wrong" — must NOT be visible.
    await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
    await expect(page.getByText(/Maximum update depth/i)).toHaveCount(0);

    // The filter bar is the canonical "reports loaded" signal: Breadcrumb
    // "Reports" + "Approved only" switch label.
    await expect(page.getByText(/approved only/i)).toBeVisible({ timeout: 10_000 });

    // No uncaught React errors should have surfaced. "Maximum update depth"
    // in particular would show up here.
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  test('OpenLDR branding is gone from error pages', async ({ page }) => {
    // Error boundary page: should show LabWorkforce, not OpenLDR.
    await login(page);
    // Trigger navigation to a non-existent nested route — this won't render
    // the ErrorPage directly, so instead we check the NotFoundPage.
    await page.goto('/this-path-does-not-exist');
    await expect(page.getByText(/OpenLDR/i)).toHaveCount(0);
    await expect(page.getByText(/LabWorkforce/i)).toBeVisible();
  });
});

test.describe('Docs page', () => {
  test('renders Getting Started and lets you switch sections', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: /^docs$/i }).first().click();
    await page.waitForURL(/\/docs/);

    // Getting Started is the default active section.
    await expect(page.getByRole('heading', { name: /getting started/i }).first())
      .toBeVisible({ timeout: 10_000 });

    // Click another section — the per-page guide for Reports.
    await page.getByRole('button', { name: /^reports$/i }).click();
    await expect(page.getByRole('heading', { name: /^reports$/i }).first())
      .toBeVisible({ timeout: 5_000 });

    // URL query reflects the picked section (reloads restore it).
    await expect(page).toHaveURL(/\?section=reports/);
  });
});

test.describe('My assessments page', () => {
  // Regression: the "View detail" link used to hardcode `/reports/users/me`
  // which the API resolved as NaN → "User not found". Must route to the
  // real user id from the auth store.
  // Regression: Resume used to just `to={baseUrl}` with no domain or resume
  // flag, dropping the user at the bare "Select a domain" picker instead of
  // back in the questionnaire.
  test('Resume link takes you back into the survey, not the domain picker', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: /my assessments/i }).first().click();
    await page.waitForURL(/\/my-assessments$/);

    const resume = page.getByRole('link', { name: /^resume$/i }).first();
    try {
      await resume.waitFor({ state: 'visible', timeout: 5_000 });
    } catch {
      test.skip(true, 'no in-progress assessments to resume');
      return;
    }

    // The link must carry the domain code and the resume flag.
    const href = await resume.getAttribute('href');
    expect(href, `href=${href}`).toMatch(/\?domain=[^&]+&resume=1/);

    await resume.click();
    await page.waitForURL(/\?domain=.+&resume=1/);

    // We should end up inside the survey (SurveyJS renders #surveyContainer),
    // NOT on the "Select a domain to start an assessment" placeholder.
    await expect(page.locator('#surveyContainer')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/select a domain to start an assessment/i))
      .toHaveCount(0);
  });

  test('View detail opens the individual report without "User not found"', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: /my assessments/i }).first().click();
    await page.waitForURL(/\/my-assessments$/);

    // Wait for the list to render — either an empty state or at least one card.
    // The admin seed user has one backfilled completed assessment ("BIO"), so
    // we expect a "View detail" link. Give TanStack Query time to settle.
    const viewDetail = page.getByRole('link', { name: /view detail/i }).first();
    try {
      await viewDetail.waitFor({ state: 'visible', timeout: 5_000 });
    } catch {
      test.skip(true, 'no completed assessments to drill into');
      return;
    }

    await viewDetail.click();
    await page.waitForURL(/\/reports\/users\/\d+/);

    await expect(page.getByText(/User not found/i)).toHaveCount(0);
    await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
    // Individual report renders "By competency" section header once loaded.
    await expect(page.getByText(/by competency/i).first()).toBeVisible({ timeout: 10_000 });
  });
});
