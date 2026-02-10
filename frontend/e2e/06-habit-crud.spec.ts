import { test, expect } from "@playwright/test";
import { loginAsGuest, createHabitAPI } from "./helpers";

test.describe("Habit CRUD", () => {
  test.describe("Create Habit Dialog", () => {
    test.beforeEach(async ({ page }) => {
      await loginAsGuest(page);
    });

    test("opens create dialog from New Habit button", async ({ page }) => {
      await page.getByRole("button", { name: /New Habit/ }).click();
      await expect(page.getByText("Create New Habit")).toBeVisible({ timeout: 5_000 });
      await expect(page.getByLabel("Name")).toBeVisible();
      await expect(page.getByText("Schedule")).toBeVisible();
      await expect(page.getByText("Daily")).toBeVisible();
      await expect(page.getByText("Specific days")).toBeVisible();
      await expect(page.getByText("Weekly target")).toBeVisible();
    });

    test("opens create dialog from empty state button", async ({ page }) => {
      await expect(page.getByRole("button", { name: /Create your first habit/ })).toBeVisible({
        timeout: 10_000,
      });
      await page.getByRole("button", { name: /Create your first habit/ }).click();
      await expect(page.getByText("Create New Habit")).toBeVisible({ timeout: 5_000 });
    });

    test("shows color picker with 9 colors", async ({ page }) => {
      await page.getByRole("button", { name: /New Habit/ }).click();
      await expect(page.getByText("Color")).toBeVisible();
      const colorButtons = page.locator("button.rounded-full.h-8.w-8");
      await expect(colorButtons).toHaveCount(9);
    });

    test("creates a daily habit successfully", async ({ page }) => {
      await page.getByRole("button", { name: /New Habit/ }).click();
      await page.getByLabel("Name").fill("Morning Run");
      await page.getByRole("button", { name: "Create Habit" }).click();

      // Dialog closes and habit appears in list
      await expect(page.getByText("Create New Habit")).not.toBeVisible({ timeout: 5_000 });
      await expect(page.getByText("Morning Run")).toBeVisible({ timeout: 10_000 });
    });

    test("selecting 'Specific days' shows day picker", async ({ page }) => {
      await page.getByRole("button", { name: /New Habit/ }).click();
      await page.getByText("Specific days").click();

      // Day buttons should appear
      await expect(page.getByText("Mon")).toBeVisible();
      await expect(page.getByText("Tue")).toBeVisible();
      await expect(page.getByText("Wed")).toBeVisible();
      await expect(page.getByText("Thu")).toBeVisible();
      await expect(page.getByText("Fri")).toBeVisible();
      await expect(page.getByText("Sat")).toBeVisible();
      await expect(page.getByText("Sun")).toBeVisible();
    });

    test("selecting 'Weekly target' shows times per week input", async ({ page }) => {
      await page.getByRole("button", { name: /New Habit/ }).click();
      await page.getByText("Weekly target").click();
      await expect(page.getByLabel("Times per week")).toBeVisible();
    });

    test("cancel button closes dialog without creating", async ({ page }) => {
      await page.getByRole("button", { name: /New Habit/ }).click();
      await page.getByLabel("Name").fill("Should Not Exist");
      await page.getByRole("button", { name: "Cancel" }).click();

      await expect(page.getByText("Create New Habit")).not.toBeVisible({ timeout: 5_000 });
      await expect(page.getByText("Should Not Exist")).not.toBeVisible();
    });
  });

  test.describe("Toggle Completion", () => {
    test("toggling a habit changes its visual state", async ({ page }) => {
      const session = await loginAsGuest(page);

      // Create a habit via API
      await createHabitAPI(session.access_token, "Toggle Test Habit");
      await page.reload();
      await page.waitForLoadState("networkidle");

      // Find the habit and click the toggle button (the circle)
      await expect(page.getByText("Toggle Test Habit")).toBeVisible({ timeout: 10_000 });
      const toggleBtn = page
        .locator("button.rounded-full.border-2")
        .first();
      await toggleBtn.click();

      // After toggle, the button should have green background (completed)
      await expect(toggleBtn).toHaveClass(/bg-green-500/, { timeout: 5_000 });
    });
  });

  test.describe("Delete Habit", () => {
    test("delete button removes habit from list", async ({ page }) => {
      const session = await loginAsGuest(page);

      // Create a habit via API
      await createHabitAPI(session.access_token, "Delete Me Habit");
      await page.reload();
      await page.waitForLoadState("networkidle");

      await expect(page.getByText("Delete Me Habit")).toBeVisible({ timeout: 10_000 });

      // Accept the confirm dialog
      page.on("dialog", (dialog) => dialog.accept());

      // Hover to reveal action buttons, then click delete
      const card = page.locator("text=Delete Me Habit").locator("..").locator("..");
      await card.hover();
      await card.locator("button.text-destructive").click();

      await expect(page.getByText("Delete Me Habit")).not.toBeVisible({ timeout: 10_000 });
    });
  });
});
