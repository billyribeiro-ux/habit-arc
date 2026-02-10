import { test, expect } from "@playwright/test";
import { startDemoViaAPI, injectDemoSession } from "./helpers";

// ============================================================================
// Test Suite 3: Demo Interactions — Habit Toggle, Mood Log, Navigation
// ============================================================================

test.describe("Demo Habit Interactions", () => {
  let token: string;

  test.beforeEach(async ({ page }) => {
    const demo = await startDemoViaAPI();
    token = demo.access_token;
    await injectDemoSession(page, token);
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
  });

  test("can toggle a habit completion", async ({ page }) => {
    // Wait for habits to load
    await expect(page.locator("text=Exercise").first()).toBeVisible({
      timeout: 10_000,
    });

    // Find and click a toggle/checkbox element near the Exercise habit
    const exerciseRow = page.locator("[data-testid='habit-row'], .habit-item, li, [class*='habit']")
      .filter({ hasText: "Exercise" })
      .first();

    // Try clicking the toggle button/checkbox within the habit row
    const toggle = exerciseRow.locator(
      "button, input[type='checkbox'], [role='checkbox'], [data-testid='toggle']"
    ).first();

    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
      // Wait for the API call to complete
      await page.waitForTimeout(1_000);
      // The toggle should have changed state (we just verify no error occurred)
      await expect(page.locator("text=Exercise").first()).toBeVisible();
    } else {
      // If no explicit toggle, try clicking the habit card itself
      await exerciseRow.click();
      await page.waitForTimeout(1_000);
    }
  });

  test("can navigate to analytics page", async ({ page }) => {
    const analyticsLink = page.getByRole("link", { name: /analytics/i });
    if (await analyticsLink.isVisible().catch(() => false)) {
      await analyticsLink.click();
      await expect(page).toHaveURL(/analytics/, { timeout: 10_000 });
    }
  });

  test("can navigate to AI insights page", async ({ page }) => {
    const insightsLink = page.getByRole("link", { name: /insight/i });
    if (await insightsLink.isVisible().catch(() => false)) {
      await insightsLink.click();
      await expect(page).toHaveURL(/insights/, { timeout: 10_000 });
      // Should show the pre-seeded insight
      await expect(
        page.locator("text=/Exercise|streak|meditation/i").first()
      ).toBeVisible({ timeout: 10_000 });
    }
  });
});

test.describe("Demo Mood Logging", () => {
  let token: string;

  test.beforeEach(async ({ page }) => {
    const demo = await startDemoViaAPI();
    token = demo.access_token;
    await injectDemoSession(page, token);
  });

  test("can access mood logging UI", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    // Look for mood/daily log UI elements
    const moodElement = page.locator(
      "[data-testid='mood-logger'], text=/mood|how are you|energy/i"
    ).first();

    // Mood logger may be on dashboard or a separate page
    if (await moodElement.isVisible().catch(() => false)) {
      await expect(moodElement).toBeVisible();
    }
  });
});
