import { test, expect } from "@playwright/test";
import { uniqueEmail } from "./helpers";

test.describe("Registration", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/register");
  });

  test("renders registration form with all fields", async ({ page }) => {
    await expect(page.getByText("Create your account")).toBeVisible();
    await expect(page.getByLabel("Name")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
  });

  test("shows link to login page", async ({ page }) => {
    const link = page.getByRole("link", { name: "Sign in" });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test("client-side validation: short password shows error", async ({ page }) => {
    await page.getByLabel("Name").fill("Test User");
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByLabel("Password").fill("short");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText("Password must be at least 8 characters")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("successful registration redirects to dashboard", async ({ page }) => {
    const email = uniqueEmail();
    await page.getByLabel("Name").fill("E2E Tester");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("securepassword123");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });

  test("duplicate email shows error", async ({ page }) => {
    const email = uniqueEmail();

    // Register first time
    await page.getByLabel("Name").fill("First User");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("securepassword123");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

    // Go back and try again with same email
    await page.evaluate(() => localStorage.clear());
    await page.goto("/register");
    await page.getByLabel("Name").fill("Second User");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("securepassword123");
    await page.getByRole("button", { name: "Create account" }).click();

    // Should show an error (not redirect)
    await expect(page.locator(".bg-destructive\\/10")).toBeVisible({ timeout: 10_000 });
  });
});
