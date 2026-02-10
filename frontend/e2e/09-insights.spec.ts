import { test, expect } from "@playwright/test";
import { loginAsDemo, loginAsGuest } from "./helpers";

test.describe("AI Insights Page", () => {
  test.describe("empty state", () => {
    test("guest user sees empty state with generate button", async ({ page }) => {
      await loginAsGuest(page);
      await page.goto("/insights");
      await page.waitForLoadState("networkidle");

      await expect(page.getByText("AI Insights")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("No insights yet")).toBeVisible();
      await expect(page.getByRole("button", { name: /Generate Insights/ })).toBeVisible();
    });
  });

  test.describe("with demo data", () => {
    test.beforeEach(async ({ page }) => {
      await loginAsDemo(page);
      await page.goto("/insights");
      await page.waitForLoadState("networkidle");
    });

    test("renders page title and description", async ({ page }) => {
      await expect(page.getByText("AI Insights")).toBeVisible({ timeout: 10_000 });
      await expect(
        page.getByText("Get personalized recommendations powered by Claude")
      ).toBeVisible();
    });

    test("Generate Insights button is visible and clickable", async ({ page }) => {
      const btn = page.getByRole("button", { name: /Generate Insights/ });
      await expect(btn).toBeVisible({ timeout: 10_000 });
      await expect(btn).toBeEnabled();
    });

    test("clicking Generate Insights shows loading state", async ({ page }) => {
      await page.getByRole("button", { name: /Generate Insights/ }).click();

      // Should show loading indicator or analyzing text
      const analyzing = page.getByText("Analyzing your habit data...");
      const loading = page.locator(".animate-spin");
      // At least one of these should appear
      await expect(analyzing.or(loading).first()).toBeVisible({ timeout: 5_000 });
    });

    test("after generating, insight cards appear", async ({ page }) => {
      await page.getByRole("button", { name: /Generate Insights/ }).click();

      // Wait for insights to load (may take a few seconds with fallback)
      await expect(page.getByText("Summary").first()).toBeVisible({ timeout: 30_000 });

      // Check for expected insight sections
      await expect(page.getByText("Streak Analysis")).toBeVisible();
      await expect(page.getByText("Tip of the Week")).toBeVisible();
    });
  });
});
