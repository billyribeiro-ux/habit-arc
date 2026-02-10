import { test, expect } from "@playwright/test";
import {
  startDemoViaAPI,
  injectDemoSession,
  getDemoStatus,
  resetDemoViaAPI,
} from "./helpers";

// ============================================================================
// Test Suite 4: Demo Reset — Full Reset Flow
// ============================================================================

test.describe("Demo Reset", () => {
  let token: string;

  test.beforeEach(async ({ page }) => {
    const demo = await startDemoViaAPI();
    token = demo.access_token;
    await injectDemoSession(page, token);
  });

  test("reset via API returns new expiry and re-seeds data", async () => {
    // Get status before reset
    const before = await getDemoStatus(token);
    expect(before.is_demo).toBe(true);
    expect(before.habits_count).toBeGreaterThanOrEqual(3);

    // Reset
    const result = await resetDemoViaAPI(token);
    expect(result.demo_expires_at).toBeTruthy();

    // Get status after reset
    const after = await getDemoStatus(token);
    expect(after.is_demo).toBe(true);
    expect(after.habits_count).toBeGreaterThanOrEqual(3);
    expect(after.insight_calls_used).toBe(0);
    // Expiry should be extended (seconds_remaining should be close to full TTL)
    expect(after.seconds_remaining).toBeGreaterThan(before.seconds_remaining);
  });

  test("clicking Reset button in banner resets demo", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    // Click the Reset button in the demo banner
    const resetBtn = page.getByRole("button", { name: /reset/i });
    await expect(resetBtn).toBeVisible({ timeout: 10_000 });
    await resetBtn.click();

    // Wait for reset to complete
    await page.waitForTimeout(2_000);

    // Dashboard should still show seeded habits
    await expect(page.locator("text=Exercise").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator("text=Meditate").first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
