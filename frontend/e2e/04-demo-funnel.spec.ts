import { test, expect } from "@playwright/test";
import {
  startDemoAPI,
  loginAsDemo,
  apiGet,
  apiPost,
  uniqueEmail,
} from "./helpers";

test.describe("Demo (Try Me) Funnel", () => {
  test("POST /api/demo/start returns token without user_id", async () => {
    const session = await startDemoAPI();
    expect(session.access_token).toBeTruthy();
    expect(session.expires_in).toBeGreaterThan(0);
    expect(session.demo_expires_at).toBeTruthy();
    // G-09: user_id must NOT be in response
    expect((session as unknown as Record<string, unknown>)["user_id"]).toBeUndefined();
  });

  test("GET /api/demo/status returns demo info", async () => {
    const session = await startDemoAPI();
    const { status, json } = await apiGet(
      "/api/demo/status",
      session.access_token
    );
    expect(status).toBe(200);
    expect(json.is_demo).toBe(true);
    expect(json.seconds_remaining).toBeGreaterThan(0);
    expect(json.habits_count).toBe(3);
    expect(json.insight_calls_max).toBe(2);
  });

  test("demo dashboard shows seeded habits and banner", async ({ page }) => {
    await loginAsDemo(page);

    // Demo banner visible
    await expect(page.getByText("Demo Mode").first()).toBeVisible({
      timeout: 10_000,
    });

    // Seeded habits visible
    await expect(page.getByText("Exercise").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Meditate").first()).toBeVisible();
    await expect(page.getByText("Read").first()).toBeVisible();
  });

  test("demo reset re-seeds data", async () => {
    const session = await startDemoAPI();

    // Reset
    const { status, json } = await apiPost(
      "/api/demo/reset",
      undefined,
      session.access_token
    );
    expect(status).toBe(200);
    expect(json.demo_expires_at).toBeTruthy();

    // Verify habits still exist after reset
    const habitsRes = await apiGet("/api/habits", session.access_token);
    expect(habitsRes.status).toBe(200);
    expect(habitsRes.json.length).toBe(3);
  });

  test("demo convert creates real account", async () => {
    const session = await startDemoAPI();
    const email = uniqueEmail();

    const { status, json } = await apiPost(
      "/api/demo/convert",
      { email, password: "securepass123", name: "Converted User" },
      session.access_token
    );
    expect(status).toBe(200);
    expect(json.access_token).toBeTruthy();
    expect(json.refresh_token).toBeTruthy();

    // Verify the new token works and user is no longer demo
    const meRes = await apiGet("/api/auth/me", json.access_token);
    expect(meRes.status).toBe(200);
    expect(meRes.json.is_demo).toBe(false);
    expect(meRes.json.email).toBe(email);
  });

  test("demo convert rejects invalid email", async () => {
    const session = await startDemoAPI();
    const { status } = await apiPost(
      "/api/demo/convert",
      { email: "notanemail", password: "securepass123", name: "Bad" },
      session.access_token
    );
    expect(status).toBe(422);
  });

  test("demo convert rejects short password", async () => {
    const session = await startDemoAPI();
    const { status } = await apiPost(
      "/api/demo/convert",
      { email: uniqueEmail(), password: "short", name: "Bad" },
      session.access_token
    );
    expect(status).toBe(422);
  });

  test("demo convert rejects duplicate email", async () => {
    const email = uniqueEmail();
    // First convert
    const s1 = await startDemoAPI();
    await apiPost(
      "/api/demo/convert",
      { email, password: "securepass123", name: "First" },
      s1.access_token
    );

    // Second convert with same email
    const s2 = await startDemoAPI();
    const { status } = await apiPost(
      "/api/demo/convert",
      { email, password: "securepass123", name: "Second" },
      s2.access_token
    );
    expect(status).toBe(409);
  });
});
