import { test, expect } from "@playwright/test";
import { uniqueEmail, registerUser } from "./helpers";

test.describe("Login", () => {
  let email: string;
  const password = "securepassword123";

  test.beforeAll(async () => {
    email = uniqueEmail();
    await registerUser(email, password, "Login Tester");
  });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/login");
  });

  test("renders login form with all fields", async ({ page }) => {
    await expect(page.getByText("Welcome back")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("shows Try Me button", async ({ page }) => {
    await expect(page.getByRole("button", { name: /Try Me/ })).toBeVisible();
  });

  test("shows link to register page", async ({ page }) => {
    const link = page.getByRole("link", { name: "Sign up" });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/register/, { timeout: 10_000 });
  });

  test("wrong credentials show error", async ({ page }) => {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("wrongpassword99");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.locator(".bg-destructive\\/10")).toBeVisible({ timeout: 10_000 });
  });

  test("successful login redirects to dashboard", async ({ page }) => {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });

  test("Try Me button starts demo and redirects to dashboard", async ({ page }) => {
    await page.getByRole("button", { name: /Try Me/ }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });
});
