import { test, expect } from "@playwright/test";

// ============================================================================
// Test Suite 7: Demo Security — Rate Limiting, Token Expiry, No user_id Leak
// ============================================================================

const API_BASE = process.env.API_BASE_URL || "http://localhost:8080";

test.describe("Demo Security", () => {
  test("start_demo response does NOT contain user_id", async () => {
    const res = await fetch(`${API_BASE}/api/demo/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: "UTC" }),
    });
    expect(res.ok).toBe(true);
    const body = await res.json();

    // Must have these fields
    expect(body.access_token).toBeTruthy();
    expect(body.expires_in).toBeGreaterThan(0);
    expect(body.demo_expires_at).toBeTruthy();

    // Must NOT have user_id
    expect(body).not.toHaveProperty("user_id");
  });

  test("rate limiter blocks excessive demo starts (4th request)", async () => {
    // Rate limit is 3 req/IP/hour
    // First 3 should succeed
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${API_BASE}/api/demo/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: "UTC" }),
      });
      expect(res.ok).toBe(true);
    }

    // 4th should be rate limited (429)
    const res = await fetch(`${API_BASE}/api/demo/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: "UTC" }),
    });
    expect(res.status).toBe(429);
  });

  test("demo token cannot access billing checkout", async () => {
    const startRes = await fetch(`${API_BASE}/api/demo/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: "UTC" }),
    });
    const { access_token } = await startRes.json();

    const checkoutRes = await fetch(`${API_BASE}/api/billing/checkout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tier: "plus" }),
    });

    // Should be forbidden (403) for demo users
    expect(checkoutRes.status).toBe(403);
  });

  test("expired/invalid token returns 401", async () => {
    const res = await fetch(`${API_BASE}/api/demo/status`, {
      headers: { Authorization: "Bearer invalid-token-here" },
    });
    expect(res.status).toBe(401);
  });

  test("missing auth header returns 401", async () => {
    const res = await fetch(`${API_BASE}/api/demo/status`);
    expect(res.status).toBe(401);
  });
});
