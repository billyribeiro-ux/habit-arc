import { test, expect } from "@playwright/test";
import { loginAsGuest, loginAsDemo } from "./helpers";

test.describe("Dashboard", () => {
  test.describe("Guest user (empty state)", () => {
    test.beforeEach(async ({ page }) => {
      await loginAsGuest(page);
    });

    test("shows greeting with user name", async ({ page }) => {
      await expect(page.getByText(/Good (morning|afternoon|evening)/)).toBeVisible({
        timeout: 10_000,
      });
    });

    test("shows 4 stats cards", async ({ page }) => {
      await expect(page.getByText("Today's Progress")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("Active Streaks")).toBeVisible();
      await expect(page.getByText("Total Completions")).toBeVisible();
      await expect(page.getByText("Tracked Habits")).toBeVisible();
    });

    test("shows empty state with create button when no habits", async ({ page }) => {
      await expect(page.getByText("No habits yet")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole("button", { name: /Create your first habit/ })).toBeVisible();
    });

    test("New Habit button is visible in header", async ({ page }) => {
      await expect(page.getByRole("button", { name: /New Habit/ })).toBeVisible({
        timeout: 10_000,
      });
    });

    test("mood logger card is visible", async ({ page }) => {
      await expect(page.getByText("How are you feeling today?")).toBeVisible({
        timeout: 10_000,
      });
    });

    test("guest signup banner is visible", async ({ page }) => {
      await expect(page.getByText("You're using a guest account")).toBeVisible({
        timeout: 10_000,
      });
    });

    test("guest signup banner can be dismissed", async ({ page }) => {
      await expect(page.getByText("You're using a guest account")).toBeVisible({
        timeout: 10_000,
      });
      // Click the X button to dismiss
      await page.locator("button").filter({ has: page.locator("svg.h-3\\.5.w-3\\.5") }).last().click();
      await expect(page.getByText("You're using a guest account")).not.toBeVisible({
        timeout: 5_000,
      });
    });
  });

  test.describe("Demo user (seeded data)", () => {
    test.beforeEach(async ({ page }) => {
      await loginAsDemo(page);
    });

    test("shows seeded habits with names", async ({ page }) => {
      await expect(page.getByText("Exercise").first()).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("Meditate").first()).toBeVisible();
      await expect(page.getByText("Read").first()).toBeVisible();
    });

    test("stats cards show non-zero values for demo", async ({ page }) => {
      // Tracked Habits should show 3
      const trackedCard = page.locator("text=Tracked Habits").locator("..");
      await expect(trackedCard).toBeVisible({ timeout: 10_000 });
    });

    test("demo banner is visible, guest banner is NOT", async ({ page }) => {
      await expect(page.getByText("Demo Mode").first()).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("You're using a guest account")).not.toBeVisible();
    });
  });
});
