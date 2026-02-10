import { test, expect } from "@playwright/test";
import { loginAsDemo, loginAsGuest } from "./helpers";

test.describe("Billing Page", () => {
  test.describe("guest user", () => {
    test.beforeEach(async ({ page }) => {
      await loginAsGuest(page);
      await page.goto("/billing");
      await page.waitForLoadState("networkidle");
    });

    test("renders page title", async ({ page }) => {
      await expect(page.getByText("Billing").first()).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("Manage your subscription and billing")).toBeVisible();
    });

    test("shows current plan card", async ({ page }) => {
      await expect(page.getByText(/Current Plan/)).toBeVisible({ timeout: 10_000 });
    });

    test("shows 3 plan cards: Free, Plus, Pro", async ({ page }) => {
      await expect(page.getByText("$0").first()).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("$4.99").first()).toBeVisible();
      await expect(page.getByText("$9.99").first()).toBeVisible();
    });

    test("Plus plan is marked as Most Popular", async ({ page }) => {
      await expect(page.getByText("Most Popular")).toBeVisible({ timeout: 10_000 });
    });

    test("Free plan shows 'Free Forever' disabled button", async ({ page }) => {
      await expect(page.getByRole("button", { name: "Free Forever" })).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByRole("button", { name: "Free Forever" })).toBeDisabled();
    });

    test("each plan lists its features", async ({ page }) => {
      await expect(page.getByText("Up to 3 habits")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("Up to 15 habits")).toBeVisible();
      await expect(page.getByText("Unlimited habits")).toBeVisible();
    });
  });

  test.describe("demo user guardrails", () => {
    test.beforeEach(async ({ page }) => {
      await loginAsDemo(page);
      await page.goto("/billing");
      await page.waitForLoadState("networkidle");
    });

    test("shows demo billing guardrail banner", async ({ page }) => {
      await expect(
        page.getByText("Billing is disabled in demo mode")
      ).toBeVisible({ timeout: 10_000 });
    });

    test("shows Sign Up button in guardrail banner", async ({ page }) => {
      await expect(
        page.getByRole("button", { name: /Sign Up/ })
      ).toBeVisible({ timeout: 10_000 });
    });

    test("upgrade buttons say 'Sign up to upgrade' for demo users", async ({ page }) => {
      const upgradeButtons = page.getByRole("button", {
        name: /Sign up to upgrade/,
      });
      await expect(upgradeButtons.first()).toBeVisible({ timeout: 10_000 });
    });

    test("clicking Sign Up navigates to demo convert page", async ({ page }) => {
      await page.getByRole("button", { name: /Sign Up/ }).first().click();
      await expect(page).toHaveURL(/\/demo\/convert/, { timeout: 10_000 });
    });
  });
});
