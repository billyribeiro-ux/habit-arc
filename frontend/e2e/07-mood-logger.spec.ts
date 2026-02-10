import { test, expect } from "@playwright/test";
import { loginAsGuest } from "./helpers";

test.describe("Mood / Energy / Stress Logger", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsGuest(page);
  });

  test("renders mood logger card with 3 slider rows", async ({ page }) => {
    await expect(page.getByText("How are you feeling today?")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Mood")).toBeVisible();
    await expect(page.getByText("Energy")).toBeVisible();
    await expect(page.getByText("Stress")).toBeVisible();
  });

  test("Log Today button is disabled when no values selected", async ({ page }) => {
    const logBtn = page.getByRole("button", { name: "Log Today" });
    await expect(logBtn).toBeVisible({ timeout: 10_000 });
    await expect(logBtn).toBeDisabled();
  });

  test("selecting mood value enables Log Today button", async ({ page }) => {
    await expect(page.getByText("How are you feeling today?")).toBeVisible({
      timeout: 10_000,
    });

    // Click mood value 4 (the 4th button in the mood row)
    const moodSection = page.getByText("Mood").locator("..").locator("..");
    const moodButtons = moodSection.locator("button.flex-1");
    await moodButtons.nth(3).click(); // value 4

    const logBtn = page.getByRole("button", { name: "Log Today" });
    await expect(logBtn).toBeEnabled();
  });

  test("saving mood shows confirmation", async ({ page }) => {
    await expect(page.getByText("How are you feeling today?")).toBeVisible({
      timeout: 10_000,
    });

    // Select mood = 4
    const moodSection = page.getByText("Mood").locator("..").locator("..");
    await moodSection.locator("button.flex-1").nth(3).click();

    // Select energy = 3
    const energySection = page.getByText("Energy").locator("..").locator("..");
    await energySection.locator("button.flex-1").nth(2).click();

    // Select stress = 2
    const stressSection = page.getByText("Stress").locator("..").locator("..");
    await stressSection.locator("button.flex-1").nth(1).click();

    // Click Log Today
    await page.getByRole("button", { name: "Log Today" }).click();

    // Should show "Saved" confirmation
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 10_000 });
  });

  test("each slider shows 5 value buttons", async ({ page }) => {
    await expect(page.getByText("How are you feeling today?")).toBeVisible({
      timeout: 10_000,
    });

    // Each of the 3 rows should have 5 buttons
    const moodSection = page.getByText("Mood").locator("..").locator("..");
    await expect(moodSection.locator("button.flex-1")).toHaveCount(5);

    const energySection = page.getByText("Energy").locator("..").locator("..");
    await expect(energySection.locator("button.flex-1")).toHaveCount(5);

    const stressSection = page.getByText("Stress").locator("..").locator("..");
    await expect(stressSection.locator("button.flex-1")).toHaveCount(5);
  });
});
