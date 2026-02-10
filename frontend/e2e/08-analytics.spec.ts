import { test, expect } from "@playwright/test";
import { loginAsDemo, loginAsGuest } from "./helpers";

test.describe("Analytics Page", () => {
  test.describe("with demo data", () => {
    test.beforeEach(async ({ page }) => {
      await loginAsDemo(page);
      await page.goto("/analytics");
      await page.waitForLoadState("networkidle");
    });

    test("renders page title and description", async ({ page }) => {
      await expect(page.getByText("Analytics")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("Track your habit performance over time")).toBeVisible();
    });

    test("shows range selector with 7d, 14d, 30d, 90d buttons", async ({ page }) => {
      await expect(page.getByRole("button", { name: "7d" })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole("button", { name: "14d" })).toBeVisible();
      await expect(page.getByRole("button", { name: "30d" })).toBeVisible();
      await expect(page.getByRole("button", { name: "90d" })).toBeVisible();
    });

    test("shows Completion Rate chart card", async ({ page }) => {
      await expect(page.getByText("Completion Rate")).toBeVisible({ timeout: 10_000 });
    });

    test("shows Daily Completions chart card", async ({ page }) => {
      await expect(page.getByText("Daily Completions")).toBeVisible({ timeout: 10_000 });
    });

    test("shows Calendar Heatmap section with habit pills", async ({ page }) => {
      await expect(page.getByText("Calendar Heatmap")).toBeVisible({ timeout: 10_000 });
      // Demo has 3 habits — should show 3 selectable pills
      await expect(page.getByText("Exercise").first()).toBeVisible();
      await expect(page.getByText("Meditate").first()).toBeVisible();
      await expect(page.getByText("Read").first()).toBeVisible();
    });

    test("clicking a habit pill loads its heatmap", async ({ page }) => {
      await expect(page.getByText("Calendar Heatmap")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("Select a habit above to view its heatmap")).toBeVisible();

      // Click Exercise pill
      await page.locator("button").filter({ hasText: "Exercise" }).first().click();

      // The "select a habit" message should disappear
      await expect(page.getByText("Select a habit above to view its heatmap")).not.toBeVisible({
        timeout: 5_000,
      });
    });

    test("shows Active Streaks leaderboard", async ({ page }) => {
      await expect(page.getByText("Active Streaks").first()).toBeVisible({ timeout: 10_000 });
    });

    test("switching range re-renders charts", async ({ page }) => {
      await expect(page.getByText("Completion Rate")).toBeVisible({ timeout: 10_000 });

      // Default is 30d, switch to 7d
      await page.getByRole("button", { name: "7d" }).click();
      await expect(page.getByText(/over last 7 days/)).toBeVisible({ timeout: 5_000 });

      // Switch to 90d
      await page.getByRole("button", { name: "90d" }).click();
      await expect(page.getByText(/over last 90 days/)).toBeVisible({ timeout: 5_000 });
    });
  });

  test.describe("with empty data", () => {
    test("guest user sees charts with zero data", async ({ page }) => {
      await loginAsGuest(page);
      await page.goto("/analytics");
      await page.waitForLoadState("networkidle");

      await expect(page.getByText("Analytics")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("Completion Rate")).toBeVisible();
    });
  });
});
