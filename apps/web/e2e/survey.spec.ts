import { test, expect, Page } from "@playwright/test";
import { TEST_ADMIN_USERNAME, TEST_ADMIN_PASSWORD } from "./reset-admin-password";

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
  await page.goto("/");
  await page.locator("#auth-login").fill(TEST_ADMIN_USERNAME);
  await page.locator("#auth-password").fill(TEST_ADMIN_PASSWORD);
  await page.getByRole("button", { name: /login|sign in/i }).click();
  await expect(page.getByRole("link", { name: /reports/i }).first()).toBeVisible({ timeout: 10_000 });
}

test.describe("Survey UX tweaks", () => {
  test("intro, bold skill levels, and footnotes render for a seeded domain", async ({ page }) => {
    const pageErrors = watchPageErrors(page);

    await login(page);

    // Find the Informatics domain id via the authenticated API.
    const domainsRes = await page.request.get("/api/assessments/domains");
    expect(domainsRes.ok()).toBeTruthy();
    const { domains } = await domainsRes.json();
    const inf = domains.find((d: { code: string }) => d.code === "INF");
    test.skip(!inf, "Informatics domain not seeded in this environment");

    // Seed intro (via update) + footnotes (via import). The quoted comma in
    // the footnote definition also exercises the CSV parser.
    const upd = await page.request.put(`/api/assessments/domains/${inf.id}`, {
      data: {
        purpose: "Purpose: applies information science to public health practice, research, and learning.",
        introduction: "Introduction: a broad field, mission-critical to the laboratory.",
      },
    });
    expect(upd.ok(), await upd.text()).toBeTruthy();

    const imp = await page.request.post(`/api/assessments/domains/${inf.id}/footnotes/import`, {
      data: { csv: 'symbol,definition,sort_order\n*,"Defined in Appendix B, the glossary.",1\n' },
    });
    expect(imp.ok(), await imp.text()).toBeTruthy();

    // Open the survey straight on Informatics.
    // NOTE: SurveyPage is mounted at the root path "/" (not "/survey").
    // The route config in main.tsx is: { path: baseUrl, element: <SurveyPage /> }
    // where baseUrl defaults to "/".
    await page.goto("/?domain=INF");

    // Start page shows the intro sections — scoped to #surveyContainer so we
    // don't accidentally match stray text elsewhere on the page.
    const survey = page.locator("#surveyContainer");
    await expect(survey.getByText(/^Purpose$/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(survey.getByText(/applies information science/i)).toBeVisible();
    await expect(survey.getByText(/^Introduction$/i).first()).toBeVisible();

    // Start the questionnaire.
    await page.getByRole("button", { name: /^start$/i }).click();
    await expect(page.locator("#surveyContainer")).toBeVisible({ timeout: 10_000 });

    // Skill level renders in bold: a <b> tag containing "Beginner" exists.
    await expect(page.locator("#surveyContainer b", { hasText: /Beginner/ }).first())
      .toBeVisible({ timeout: 10_000 });

    // Footnote definition text appears somewhere on the page (the seeded "*").
    await expect(page.getByText(/Defined in Appendix B/i).first()).toBeVisible({ timeout: 10_000 });

    // No uncaught React errors should have surfaced during the whole test.
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });
});
