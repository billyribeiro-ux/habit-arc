import { test, expect } from "@playwright/test";
import { startDemoViaAPI, injectDemoSession } from "./helpers";

// ============================================================================
// Test Suite 6: Demo Billing Guardrail — Checkout Blocked
// ============================================================================

test.describe("Demo Billing Guardrail", () => {
  let token: string;

  test.beforeEach(async ({ page }) => {
    const demo = await startDemoViaAPI();
    token = demo.access_token;
    await injectDemoSession(page, token);
  });

  test("billing page shows demo signup prompt instead of checkout", async ({
    page,
  }) => {
    await page.goto("/billing");
    await page.waitForLoadState("networkidle");

    // Should show a message directing demo users to sign up
    const demoPrompt = page.locator(
      "text=/sign up|create.*account|demo.*user/i"
    ).first();
    await expect(demoPrompt).toBeVisible({ timeout: 10_000 });
  });

  test("upgrade buttons are disabled for demo users", async ({ page }) => {
    await page.goto("/billing");
    await page.waitForLoadState("networkidle");

    // Find upgrade/checkout buttons
    const upgradeButtons = page.locator(
      "button:has-text('Upgrade'), button:has-text('Subscribe'), button:has-text('Checkout')"
    );

    const count = await upgradeButtons.count();
    for (let i = 0; i < count; i++) {
      const btn = upgradeButtons.nth(i);
      if (await btn.isVisible().catch(() => false)) {
        await expect(btn).toBeDisabled();
      }
    }
  });
});
