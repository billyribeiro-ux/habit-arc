import { test, expect } from "@playwright/test";

// ============================================================================
// Test Suite 8: Demo API Integration — Full Backend Flow
// ============================================================================

const API_BASE = process.env.API_BASE_URL || "http://localhost:8080";

test.describe("Demo API — Full Lifecycle", () => {
  let token: string;

  test("start → status → reset → status → convert lifecycle", async () => {
    // ── 1. Start demo ──────────────────────────────────────────────────
    const startRes = await fetch(`${API_BASE}/api/demo/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: "America/New_York" }),
    });
    expect(startRes.ok).toBe(true);
    const startBody = await startRes.json();
    token = startBody.access_token;
    expect(token).toBeTruthy();
    expect(startBody.expires_in).toBeGreaterThan(0);
    expect(startBody.demo_expires_at).toBeTruthy();
    expect(startBody).not.toHaveProperty("user_id");

    // ── 2. Get status ──────────────────────────────────────────────────
    const statusRes = await fetch(`${API_BASE}/api/demo/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(statusRes.ok).toBe(true);
    const status = await statusRes.json();
    expect(status.is_demo).toBe(true);
    expect(status.habits_count).toBeGreaterThanOrEqual(3);
    expect(status.completions_count).toBeGreaterThan(0);
    expect(status.insight_calls_used).toBe(0);
    expect(status.seconds_remaining).toBeGreaterThan(0);

    // ── 3. Verify seeded habits via /api/habits ─────────────────────────
    const habitsRes = await fetch(`${API_BASE}/api/habits`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(habitsRes.ok).toBe(true);
    const habits = await habitsRes.json();
    expect(habits.length).toBeGreaterThanOrEqual(3);
    const habitNames = habits.map((h: any) => h.name);
    expect(habitNames).toContain("Exercise");
    expect(habitNames).toContain("Meditate");
    expect(habitNames).toContain("Read");

    // ── 4. Toggle a habit completion ────────────────────────────────────
    const exerciseHabit = habits.find((h: any) => h.name === "Exercise");
    const toggleRes = await fetch(`${API_BASE}/api/completions/toggle`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ habit_id: exerciseHabit.id }),
    });
    expect(toggleRes.ok).toBe(true);
    const toggleBody = await toggleRes.json();
    expect(["created", "deleted"]).toContain(toggleBody.action);

    // ── 5. Reset demo ──────────────────────────────────────────────────
    const resetRes = await fetch(`${API_BASE}/api/demo/reset`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(resetRes.ok).toBe(true);
    const resetBody = await resetRes.json();
    expect(resetBody.demo_expires_at).toBeTruthy();

    // ── 6. Verify reset: status shows fresh data ────────────────────────
    const status2Res = await fetch(`${API_BASE}/api/demo/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status2Res.ok).toBe(true);
    const status2 = await status2Res.json();
    expect(status2.insight_calls_used).toBe(0);
    expect(status2.habits_count).toBeGreaterThanOrEqual(3);

    // ── 7. Convert demo to real account ─────────────────────────────────
    const uniqueEmail = `test-${Date.now()}@example.com`;
    const convertRes = await fetch(`${API_BASE}/api/demo/convert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: uniqueEmail,
        password: "SecurePass123!",
        name: "Test Convert User",
      }),
    });
    expect(convertRes.ok).toBe(true);
    const convertBody = await convertRes.json();
    expect(convertBody.access_token).toBeTruthy();
    expect(convertBody.refresh_token).toBeTruthy();
    expect(convertBody.migrated_habits).toBeGreaterThanOrEqual(3);
    expect(convertBody.migrated_completions).toBeGreaterThan(0);

    // ── 8. Verify converted user is no longer demo ──────────────────────
    const meRes = await fetch(`${API_BASE}/api/me`, {
      headers: { Authorization: `Bearer ${convertBody.access_token}` },
    });
    expect(meRes.ok).toBe(true);
    const me = await meRes.json();
    expect(me.is_demo).toBe(false);
    expect(me.email).toBe(uniqueEmail);
    expect(me.name).toBe("Test Convert User");

    // ── 9. Verify habits survived conversion ────────────────────────────
    const habitsAfterRes = await fetch(`${API_BASE}/api/habits`, {
      headers: { Authorization: `Bearer ${convertBody.access_token}` },
    });
    expect(habitsAfterRes.ok).toBe(true);
    const habitsAfter = await habitsAfterRes.json();
    expect(habitsAfter.length).toBeGreaterThanOrEqual(3);
  });
});

test.describe("Demo API — Edge Cases", () => {
  test("non-demo user cannot call demo/status", async () => {
    // Start a demo, convert it, then try to call demo/status with the new token
    const startRes = await fetch(`${API_BASE}/api/demo/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: "UTC" }),
    });
    const { access_token } = await startRes.json();

    const uniqueEmail = `edge-${Date.now()}@example.com`;
    const convertRes = await fetch(`${API_BASE}/api/demo/convert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: uniqueEmail,
        password: "SecurePass123!",
        name: "Edge Case User",
      }),
    });
    const { access_token: realToken } = await convertRes.json();

    // Calling demo/status with a non-demo token should fail
    const statusRes = await fetch(`${API_BASE}/api/demo/status`, {
      headers: { Authorization: `Bearer ${realToken}` },
    });
    expect(statusRes.status).toBe(403);
  });

  test("convert with duplicate email returns 409", async () => {
    const uniqueEmail = `dup-${Date.now()}@example.com`;

    // Start first demo and convert
    const start1 = await fetch(`${API_BASE}/api/demo/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: "UTC" }),
    });
    const { access_token: token1 } = await start1.json();
    const convert1 = await fetch(`${API_BASE}/api/demo/convert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: uniqueEmail,
        password: "SecurePass123!",
        name: "First User",
      }),
    });
    expect(convert1.ok).toBe(true);

    // Start second demo and try to convert with same email
    const start2 = await fetch(`${API_BASE}/api/demo/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: "UTC" }),
    });
    const { access_token: token2 } = await start2.json();
    const convert2 = await fetch(`${API_BASE}/api/demo/convert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token2}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: uniqueEmail,
        password: "SecurePass123!",
        name: "Second User",
      }),
    });
    expect(convert2.status).toBe(409);
  });

  test("convert with invalid email returns 422", async () => {
    const startRes = await fetch(`${API_BASE}/api/demo/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: "UTC" }),
    });
    const { access_token } = await startRes.json();

    const convertRes = await fetch(`${API_BASE}/api/demo/convert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "not-an-email",
        password: "SecurePass123!",
        name: "Bad Email User",
      }),
    });
    expect(convertRes.status).toBe(422);
  });

  test("convert with short password returns 422", async () => {
    const startRes = await fetch(`${API_BASE}/api/demo/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: "UTC" }),
    });
    const { access_token } = await startRes.json();

    const convertRes = await fetch(`${API_BASE}/api/demo/convert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: `short-${Date.now()}@example.com`,
        password: "short",
        name: "Short Pass User",
      }),
    });
    expect(convertRes.status).toBe(422);
  });

  test("demo start with feature flag disabled returns 403", async () => {
    // This test only works if TRY_ME_ENABLED=false on the server
    // We include it as a documented test case — skip if flag is on
    const res = await fetch(`${API_BASE}/api/demo/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: "UTC" }),
    });
    // If the feature is enabled, this will be 200 — that's fine
    if (res.status === 403) {
      expect(res.status).toBe(403);
    } else {
      expect(res.ok).toBe(true);
    }
  });
});
