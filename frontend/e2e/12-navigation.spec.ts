import { test, expect } from "@playwright/test";
import { loginAsGuest, loginAsDemo } from "./helpers";

test.describe("Navigation & Layout", () => {
  test.describe("sidebar (desktop)", () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test.beforeEach(async ({ page }) => {
      await loginAsGuest(page);
    });

    test("sidebar shows HabitArc logo", async ({ page }) => {
      await expect(page.getByText("HabitArc").first()).toBeVisible({ timeout: 10_000 });
    });

    test("sidebar shows all 5 nav links", async ({ page }) => {
      await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole("link", { name: "Analytics" })).toBeVisible();
      await expect(page.getByRole("link", { name: "AI Insights" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Billing" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
    });

    test("clicking Analytics link navigates to /analytics", async ({ page }) => {
      await page.getByRole("link", { name: "Analytics" }).click();
      await expect(page).toHaveURL(/\/analytics/, { timeout: 10_000 });
    });

    test("clicking AI Insights link navigates to /insights", async ({ page }) => {
      await page.getByRole("link", { name: "AI Insights" }).click();
      await expect(page).toHaveURL(/\/insights/, { timeout: 10_000 });
    });

    test("clicking Billing link navigates to /billing", async ({ page }) => {
      await page.getByRole("link", { name: "Billing" }).click();
      await expect(page).toHaveURL(/\/billing/, { timeout: 10_000 });
    });

    test("clicking Settings link navigates to /settings", async ({ page }) => {
      await page.getByRole("link", { name: "Settings" }).click();
      await expect(page).toHaveURL(/\/settings/, { timeout: 10_000 });
    });

    test("sidebar shows user avatar initial and name", async ({ page }) => {
      // Guest user name is "Guest"
      await expect(page.getByText("Guest").first()).toBeVisible({ timeout: 10_000 });
    });

    test("sidebar shows tier label", async ({ page }) => {
      await expect(page.getByText("Free Plan").first()).toBeVisible({ timeout: 10_000 });
    });

    test("sidebar logout button works", async ({ page }) => {
      // The logout button is the last icon button in the sidebar user section
      const logoutBtn = page.locator("aside button").last();
      await logoutBtn.click();
      await expect(page).toHaveURL(/\/(onboarding|login)/, { timeout: 15_000 });
    });
  });

  test.describe("demo user sidebar label", () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test("shows 'Demo Mode' instead of plan name", async ({ page }) => {
      await loginAsDemo(page);
      await expect(page.getByText("Demo Mode").first()).toBeVisible({ timeout: 10_000 });
    });
  });

  test.describe("mobile bottom nav", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("shows bottom nav with 4 items on mobile", async ({ page }) => {
      await loginAsGuest(page);

      // Bottom nav should have Dashboard, Analytics, AI Insights, Billing
      const bottomNav = page.locator("nav.fixed.inset-x-0.bottom-0");
      await expect(bottomNav).toBeVisible({ timeout: 10_000 });

      await expect(bottomNav.getByText("Dashboard")).toBeVisible();
      await expect(bottomNav.getByText("Analytics")).toBeVisible();
      await expect(bottomNav.getByText("AI Insights")).toBeVisible();
      await expect(bottomNav.getByText("Billing")).toBeVisible();
    });

    test("mobile header shows HabitArc branding", async ({ page }) => {
      await loginAsGuest(page);
      const header = page.locator("header.fixed");
      await expect(header.getByText("HabitArc")).toBeVisible({ timeout: 10_000 });
    });
  });

  test.describe("auth guard", () => {
    test("unauthenticated user is redirected to /onboarding", async ({ page }) => {
      await page.goto("/");
      await page.evaluate(() => localStorage.clear());
      await page.goto("/dashboard");
      await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });
    });

    test("unauthenticated user cannot access /analytics", async ({ page }) => {
      await page.goto("/");
      await page.evaluate(() => localStorage.clear());
      await page.goto("/analytics");
      await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });
    });

    test("unauthenticated user cannot access /settings", async ({ page }) => {
      await page.goto("/");
      await page.evaluate(() => localStorage.clear());
      await page.goto("/settings");
      await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });
    });
  });
});
