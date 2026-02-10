import { test, expect } from "@playwright/test";
import { loginAsGuest } from "./helpers";

test.describe("Settings Page", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsGuest(page);
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("Settings").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Manage your account and preferences")).toBeVisible();
  });

  test("shows Profile card with name and email fields", async ({ page }) => {
    await expect(page.getByText("Profile").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel("Name")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
  });

  test("email field is disabled", async ({ page }) => {
    await expect(page.getByLabel("Email")).toBeDisabled({ timeout: 10_000 });
  });

  test("guest user sees signup prompt under email", async ({ page }) => {
    await expect(
      page.getByText("Sign up to secure your account and data")
    ).toBeVisible({ timeout: 10_000 });
  });

  test("shows Save Changes button", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Save Changes" })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("shows Timezone card with timezone selector", async ({ page }) => {
    await expect(page.getByText("Timezone").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel("Your timezone")).toBeVisible();
  });

  test("timezone selector has common timezone options", async ({ page }) => {
    const select = page.getByLabel("Your timezone");
    await expect(select).toBeVisible({ timeout: 10_000 });

    // Check a few known options exist
    await expect(select.locator("option[value='America/New_York']")).toBeAttached();
    await expect(select.locator("option[value='Europe/London']")).toBeAttached();
    await expect(select.locator("option[value='Asia/Tokyo']")).toBeAttached();
    await expect(select.locator("option[value='UTC']")).toBeAttached();
  });

  test("shows Notifications card", async ({ page }) => {
    await expect(page.getByText("Notifications").first()).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText("Notification preferences will be available in a future update")
    ).toBeVisible();
  });

  test("shows Danger Zone with Sign Out and Delete Account", async ({ page }) => {
    await expect(page.getByText("Danger Zone")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Sign Out" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete Account" })).toBeVisible();
  });

  test("Delete Account button is disabled", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Delete Account" })).toBeDisabled({
      timeout: 10_000,
    });
  });

  test("Sign Out button logs user out", async ({ page }) => {
    await page.getByRole("button", { name: "Sign Out" }).click();
    // Should redirect to onboarding or login
    await expect(page).toHaveURL(/\/(onboarding|login)/, { timeout: 15_000 });
  });
});
