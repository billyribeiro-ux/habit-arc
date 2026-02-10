import { test, expect } from "@playwright/test";

// ============================================================================
// Test Suite 1: Demo Start — Onboarding & Login CTAs
// ============================================================================

test.describe("Demo Start — Onboarding CTA", () => {
  test("onboarding page renders Try Me button", async ({ page }) => {
    await page.goto("/onboarding");
    // Navigate to the last onboarding screen where Try Me CTA appears
    const nextBtn = page.getByRole("button", { name: /next|continue/i });
    // Click through screens until we see the Try Me button or run out of screens
    for (let i = 0; i < 5; i++) {
      const tryMe = page.getByRole("button", { name: /try me|try it/i });
      if (await tryMe.isVisible().catch(() => false)) break;
      if (await nextBtn.isVisible().catch(() => false)) {
        await nextBtn.click();
        await page.waitForTimeout(300);
      }
    }
    const tryMeBtn = page.getByRole("button", { name: /try me|try it/i });
    await expect(tryMeBtn).toBeVisible({ timeout: 5_000 });
  });

  test("clicking Try Me starts demo and redirects to dashboard", async ({
    page,
  }) => {
    await page.goto("/onboarding");
    // Navigate to Try Me button
    const nextBtn = page.getByRole("button", { name: /next|continue/i });
    for (let i = 0; i < 5; i++) {
      const tryMe = page.getByRole("button", { name: /try me|try it/i });
      if (await tryMe.isVisible().catch(() => false)) break;
      if (await nextBtn.isVisible().catch(() => false)) {
        await nextBtn.click();
        await page.waitForTimeout(300);
      }
    }
    const tryMeBtn = page.getByRole("button", { name: /try me|try it/i });
    await tryMeBtn.click();

    // Should redirect to dashboard
    await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 });

    // localStorage should have demo flag
    const isDemo = await page.evaluate(() => localStorage.getItem("is_demo"));
    expect(isDemo).toBe("true");

    // Access token should be set
    const token = await page.evaluate(() =>
      localStorage.getItem("access_token")
    );
    expect(token).toBeTruthy();
  });
});

test.describe("Demo Start — Login Page CTA", () => {
  test("login page renders Try Me button", async ({ page }) => {
    await page.goto("/login");
    const tryMeBtn = page.getByRole("button", { name: /try me|try it/i });
    await expect(tryMeBtn).toBeVisible({ timeout: 5_000 });
  });

  test("clicking Try Me on login starts demo session", async ({ page }) => {
    await page.goto("/login");
    const tryMeBtn = page.getByRole("button", { name: /try me|try it/i });
    await tryMeBtn.click();

    await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 });

    const isDemo = await page.evaluate(() => localStorage.getItem("is_demo"));
    expect(isDemo).toBe("true");
  });
});
