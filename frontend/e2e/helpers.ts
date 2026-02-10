import { type Page, type BrowserContext, expect } from "@playwright/test";

// ── Config ───────────────────────────────────────────────────────────────────

export const API = process.env.API_BASE_URL || "http://localhost:8080";
export const APP = process.env.BASE_URL || "http://localhost:3000";

// ── API helpers ──────────────────────────────────────────────────────────────

export async function apiPost(path: string, body?: object, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

export async function apiGet(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { headers });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// ── Demo session helpers ─────────────────────────────────────────────────────

export interface DemoSession {
  access_token: string;
  expires_in: number;
  demo_expires_at: string;
}

export async function startDemoAPI(): Promise<DemoSession> {
  const { status, json } = await apiPost("/api/demo/start", {
    timezone: "America/New_York",
  });
  if (status !== 200) throw new Error(`Demo start failed: ${status}`);
  return json as DemoSession;
}

export async function injectDemoSession(page: Page, token: string) {
  await page.goto("/");
  await page.evaluate(
    ({ t }) => {
      localStorage.setItem("access_token", t);
      localStorage.setItem("is_demo", "true");
    },
    { t: token }
  );
}

export async function loginAsDemo(page: Page): Promise<DemoSession> {
  const session = await startDemoAPI();
  await injectDemoSession(page, session.access_token);
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  return session;
}

// ── Guest session helpers ────────────────────────────────────────────────────

export interface GuestSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  guest_token: string;
}

export async function startGuestAPI(): Promise<GuestSession> {
  const { status, json } = await apiPost("/api/auth/guest", {
    timezone: "America/New_York",
  });
  if (status !== 200) throw new Error(`Guest start failed: ${status} ${JSON.stringify(json)}`);
  return json as GuestSession;
}

export async function injectGuestSession(page: Page, session: GuestSession) {
  await page.goto("/");
  await page.evaluate(
    ({ a, r }) => {
      localStorage.setItem("access_token", a);
      localStorage.setItem("refresh_token", r);
    },
    { a: session.access_token, r: session.refresh_token }
  );
}

export async function loginAsGuest(page: Page): Promise<GuestSession> {
  const session = await startGuestAPI();
  await injectGuestSession(page, session);
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  return session;
}

// ── Registered user helpers ──────────────────────────────────────────────────

export interface RegisteredSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export async function registerUser(
  email: string,
  password: string,
  name: string
): Promise<RegisteredSession> {
  const { status, json } = await apiPost("/api/auth/register", {
    email,
    password,
    name,
  });
  if (status !== 200 && status !== 201)
    throw new Error(`Register failed: ${status} ${JSON.stringify(json)}`);
  return json as RegisteredSession;
}

export async function loginUser(
  email: string,
  password: string
): Promise<RegisteredSession> {
  const { status, json } = await apiPost("/api/auth/login", {
    email,
    password,
  });
  if (status !== 200)
    throw new Error(`Login failed: ${status} ${JSON.stringify(json)}`);
  return json as RegisteredSession;
}

export async function injectRegisteredSession(
  page: Page,
  session: RegisteredSession
) {
  await page.goto("/");
  await page.evaluate(
    ({ a, r }) => {
      localStorage.setItem("access_token", a);
      localStorage.setItem("refresh_token", r);
    },
    { a: session.access_token, r: session.refresh_token }
  );
}

export async function loginAsRegistered(
  page: Page,
  email: string,
  password: string,
  name: string
): Promise<RegisteredSession> {
  const session = await registerUser(email, password, name);
  await injectRegisteredSession(page, session);
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  return session;
}

// ── Habit helpers ────────────────────────────────────────────────────────────

export async function createHabitAPI(
  token: string,
  name: string,
  opts?: { frequency?: string; color?: string }
) {
  return apiPost(
    "/api/habits",
    {
      name,
      frequency: opts?.frequency ?? "daily",
      color: opts?.color ?? "#6366f1",
      target_per_day: 1,
    },
    token
  );
}

// ── Assertion helpers ────────────────────────────────────────────────────────

export async function expectPath(page: Page, path: string) {
  await expect(page).toHaveURL(new RegExp(path), { timeout: 15_000 });
}

export async function expectVisible(page: Page, text: string) {
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 10_000 });
}

export async function expectNotVisible(page: Page, text: string) {
  await expect(page.getByText(text)).not.toBeVisible({ timeout: 5_000 });
}

// ── Unique ID for test isolation ─────────────────────────────────────────────

let counter = 0;
export function uniqueEmail(): string {
  counter++;
  return `test+${Date.now()}_${counter}@habitarc.test`;
}
