import { test, expect } from "@playwright/test";
import { startDemoViaAPI, injectDemoSession } from "./helpers";

// ============================================================================
// Test Suite 5: Demo Convert — Full Conversion Flow
// ============================================================================

test.describe("Demo Convert Page", () => {
  let token: string;

  test.beforeEach(async ({ page }) => {
    const demo = await startDemoViaAPI();
    token = demo.access_token;
    await injectDemoSession(page, token);
  });

  test("convert page renders signup form", async ({ page }) => {
    await page.goto("/demo/convert");
    await page.waitForLoadState("networkidle");

    // Should have email, password, name fields and a submit button
    await expect(
      page.locator("input[type='email'], input[name='email'], input[placeholder*='email' i]").first()
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator("input[type='password'], input[name='password']").first()
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator("input[name='name'], input[placeholder*='name' i]").first()
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("button", { name: /create|sign up|save/i })
    ).toBeVisible({ timeout: 10_000 });
  });

  test("convert form validates empty fields", async ({ page }) => {
    await page.goto("/demo/convert");
    await page.waitForLoadState("networkidle");

    // Click submit without filling anything
    const submitBtn = page.getByRole("button", { name: /create|sign up|save/i });
    await submitBtn.click();

    // Should show validation error or HTML5 validation prevents submission
    // (we just verify we're still on the convert page)
    await expect(page).toHaveURL(/demo\/convert/, { timeout: 5_000 });
  });

  test("convert form validates short password", async ({ page }) => {
    await page.goto("/demo/convert");
    await page.waitForLoadState("networkidle");

    const emailInput = page.locator(
      "input[type='email'], input[name='email'], input[placeholder*='email' i]"
    ).first();
    const passwordInput = page.locator(
      "input[type='password'], input[name='password']"
    ).first();
    const nameInput = page.locator(
      "input[name='name'], input[placeholder*='name' i]"
    ).first();

    await emailInput.fill("test@example.com");
    await passwordInput.fill("short"); // < 8 chars
    await nameInput.fill("Test User");

    const submitBtn = page.getByRole("button", { name: /create|sign up|save/i });
    await submitBtn.click();

    // Should show error or stay on page
    await page.waitForTimeout(2_000);
    await expect(page).toHaveURL(/demo\/convert/, { timeout: 5_000 });
  });

  test("Save your progress banner button navigates to convert page", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    const saveBtn = page.getByRole("button", {
      name: /save your progress/i,
    });
    await expect(saveBtn).toBeVisible({ timeout: 10_000 });
    await saveBtn.click();

    await expect(page).toHaveURL(/demo\/convert/, { timeout: 10_000 });
  });
});
