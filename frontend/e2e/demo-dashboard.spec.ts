import { test, expect } from "@playwright/test";
import {
  startDemoViaAPI,
  injectDemoSession,
  expectDemoBanner,
} from "./helpers";

// ============================================================================
// Test Suite 2: Demo Dashboard — Seeded Data, Banner, Interactions
// ============================================================================

test.describe("Demo Dashboard", () => {
  let token: string;

  test.beforeEach(async ({ page }) => {
    const demo = await startDemoViaAPI();
    token = demo.access_token;
    await injectDemoSession(page, token);
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
  });

  test("demo banner is visible with countdown", async ({ page }) => {
    await expectDemoBanner(page);
    // Should show time remaining
    const timeText = page.locator("text=/\\d+[hm:]\\d+/");
    await expect(timeText.first()).toBeVisible({ timeout: 10_000 });
  });

  test("demo banner shows Reset button", async ({ page }) => {
    const resetBtn = page.getByRole("button", { name: /reset/i });
    await expect(resetBtn).toBeVisible({ timeout: 10_000 });
  });

  test("demo banner shows Save your progress button", async ({ page }) => {
    const saveBtn = page.getByRole("button", {
      name: /save your progress/i,
    });
    await expect(saveBtn).toBeVisible({ timeout: 10_000 });
  });

  test("seeded habits are visible on dashboard", async ({ page }) => {
    // The demo seeds 3 habits: Exercise, Meditate, Read
    await expect(page.locator("text=Exercise").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator("text=Meditate").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator("text=Read").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("sidebar shows Demo Mode instead of plan name", async ({ page }) => {
    const demoLabel = page.locator("text=Demo Mode");
    await expect(demoLabel.first()).toBeVisible({ timeout: 10_000 });
  });
});
