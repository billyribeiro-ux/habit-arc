import { test, expect } from "@playwright/test";

test.describe("Onboarding", () => {
  test.beforeEach(async ({ page }) => {
    // Clear any existing session
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/onboarding");
  });

  test("renders first screen with title and Next button", async ({ page }) => {
    await expect(page.getByText("Build habits that stick")).toBeVisible();
    await expect(page.getByRole("button", { name: "Next" })).toBeVisible();
    await expect(page.getByText("Try the app first")).toBeVisible();
  });

  test("navigates through all 3 onboarding screens", async ({ page }) => {
    // Screen 1
    await expect(page.getByText("Build habits that stick")).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();

    // Screen 2
    await expect(page.getByText("Streaks keep you going")).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();

    // Screen 3 — final screen shows Get Started + Try Me
    await expect(page.getByText("Insights that matter")).toBeVisible();
    await expect(page.getByRole("button", { name: /Get Started/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Try Me/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /I already have an account/ })).toBeVisible();
  });

  test("progress dots are clickable and update the screen", async ({ page }) => {
    // There should be 3 dots
    const dots = page.locator("button.rounded-full.h-2");
    await expect(dots).toHaveCount(3);

    // Click the third dot to jump to last screen
    await dots.nth(2).click();
    await expect(page.getByText("Insights that matter")).toBeVisible();

    // Click first dot to go back
    await dots.nth(0).click();
    await expect(page.getByText("Build habits that stick")).toBeVisible();
  });

  test("'I already have an account' navigates to login", async ({ page }) => {
    // Go to last screen
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();

    await page.getByRole("button", { name: /I already have an account/ }).click();
    await expect(page).toHaveURL(/\/register/, { timeout: 10_000 });
  });

  test("'Try the app first' button is visible on early screens", async ({ page }) => {
    await expect(page.getByText("Try the app first")).toBeVisible();
  });
});
