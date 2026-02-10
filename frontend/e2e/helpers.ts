import { type Page, expect } from "@playwright/test";

const API_BASE = process.env.API_BASE_URL || "http://localhost:8080";

/**
 * Start a demo session via the API directly and inject the token into the browser.
 * Returns the demo access token and expiry.
 */
export async function startDemoViaAPI(): Promise<{
  access_token: string;
  expires_in: number;
  demo_expires_at: string;
}> {
  const res = await fetch(`${API_BASE}/api/demo/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ timezone: "America/New_York" }),
  });
  if (!res.ok) {
    throw new Error(`Failed to start demo: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/**
 * Inject a demo token into the browser's localStorage so the app
 * treats the session as an authenticated demo user.
 */
export async function injectDemoSession(page: Page, token: string) {
  await page.goto("/");
  await page.evaluate(
    ({ token }) => {
      localStorage.setItem("access_token", token);
      localStorage.setItem("is_demo", "true");
    },
    { token }
  );
}

/**
 * Get demo status from the API.
 */
export async function getDemoStatus(token: string) {
  const res = await fetch(`${API_BASE}/api/demo/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to get demo status: ${res.status} ${await res.text()}`
    );
  }
  return res.json();
}

/**
 * Reset demo via the API.
 */
export async function resetDemoViaAPI(token: string) {
  const res = await fetch(`${API_BASE}/api/demo/reset`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to reset demo: ${res.status} ${await res.text()}`
    );
  }
  return res.json();
}

/**
 * Assert that the demo banner is visible with expected content.
 */
export async function expectDemoBanner(page: Page) {
  const banner = page.locator("text=Demo Mode");
  await expect(banner.first()).toBeVisible({ timeout: 10_000 });
}

/**
 * Assert that the page has navigated to the expected path.
 */
export async function expectPath(page: Page, path: string) {
  await expect(page).toHaveURL(new RegExp(path), { timeout: 10_000 });
}
