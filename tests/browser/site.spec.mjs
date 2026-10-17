import { test, expect } from "../support/browser.mjs";

const API = "http://127.0.0.1:8787/api";
const DAY = 86400000;
function report(url) {
  const selection = Object.fromEntries(new URL(url).searchParams);
  const daily = [];
  for (let date = selection.from; date <= selection.to; date = new Date(Date.parse(date) + DAY).toISOString().slice(0, 10)) {
    daily.push({ date, page_views: 8, sessions: 6, outbound_clicks: 4, youtube: 3, instagram: 1 });
  }
  const n = daily.length;
  const qr = selection.source === "direct" ? 0 : selection.source === "qr" ? 8 * n : 5 * n;
  return {
    version: 1, generated_at: "2026-09-13T12:00:00Z", range: { ...selection, time_zone: "UTC" },
    totals: { page_views: 8 * n, sessions: 6 * n, outbound_clicks: 4 * n, youtube: 3 * n, instagram: n, converted_sessions: 3 * n },
    daily, sources: { qr, direct: 8 * n - qr },
    destinations: { instagram_only: 0, youtube_only: 2 * n, both: n },
  };
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-13T12:00:00Z"));
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", event => window.__cspViolations.push(event.violatedDirective));
  });
  // Browser tests never send credentials, analytics or data requests to AWS.
  await page.route(`${API}/**`, route => route.fulfill({ status: 401, json: { error: "test_unauthorized" } }));
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.route("https://fonts.gstatic.com/**", route => route.abort());
});

test("homepage keeps QR query, picture, real social links and mobile layout", async ({ page }) => {
  const calls = [];
  page.on("request", request => { if (request.url().startsWith(API)) calls.push(request.url()); });
  const response = await page.goto("/?q=street");
  expect(response.status()).toBe(200);
  expect(page.url()).toContain("?q=street");
  await expect(page).toHaveTitle("Kanata's links");
  await expect(page.locator('[data-platform="youtube"]')).toHaveAttribute("href", "https://www.youtube.com/@kanataguitar");
  await expect(page.locator('[data-platform="instagram"]')).toHaveAttribute("href", "https://www.instagram.com/kanatavii/");
  expect(await page.locator(".profile-photo").evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.waitForTimeout(1700);
  expect(calls).toEqual([]);
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
});

test("existing panel URL redirects guests to login; unknown paths are real 404s", async ({ page, request, context }) => {
  await context.clearCookies();
  await page.goto("/stat-panel/index.html");
  await expect(page).toHaveURL(/\/test\/access\/login/);
  const response = await request.get("/not-a-real-page");
  expect(response.status()).toBe(404);
  expect((await request.get("/.github/workflows/deploy.yml")).status()).toBe(404);
  expect((await request.get("/site.config.json")).status()).toBe(404);
  expect((await request.get("/statpanel")).url()).toMatch(/\/test\/access\/login/);
});

test("Access cookies, date filters, charts, mobile view and logout keep working", async ({ page }) => {
  const errors = [], seen = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route(`${API}/**`, async route => {
    const request = route.request();
    const headers = { "Access-Control-Allow-Origin": "http://127.0.0.1:8787", "Access-Control-Allow-Headers": "authorization,content-type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    expect(request.headers().authorization).toBeUndefined();
    expect(request.headers().cookie).toContain('test_access=valid');
    seen.push(request.url());
    return route.fulfill({ headers, json: report(request.url()) });
  });
  await page.goto("/stat-panel/");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#views-value")).toHaveText("240");
  await expect(page.locator("#platform-bars .bar-heading")).toHaveCount(3);
  await expect(page.locator("#chart svg")).toHaveCount(1);
  await page.locator('[data-days="1"]').click();
  await expect(page.locator("#views-value")).toHaveText("8");
  await expect(page.locator("#chart .day-bar-row")).toHaveCount(2);
  await page.locator("#open-calendar").click();
  await expect(page.locator("#date-calendar")).toBeVisible();
  await page.locator('[data-date="2026-09-10"]').click();
  await expect(page.locator("#from")).toHaveValue("2026-09-10");
  await page.locator('[data-days="7"]').click();
  await expect(page.locator("#views-value")).toHaveText("56");
  await page.locator("#source").selectOption("qr");
  await expect(page.locator("#source-bars .bar-heading").first()).toContainText("100");
  expect(seen.some(url => url.includes("source=qr"))).toBe(true);
  const beforeCustomRange = seen.length;
  await page.locator("#from").fill("2026-09-01");
  await page.locator("#to").fill("2026-09-03");
  await expect(page.locator("#views-value")).toHaveText("56");
  expect(seen).toHaveLength(beforeCustomRange);
  await page.getByRole("button", { name: "Показать", exact: true }).click();
  await expect(page.locator("#views-value")).toHaveText("24");
  expect(Object.fromEntries(new URL(seen.at(-1)).searchParams)).toEqual({ from: "2026-09-01", to: "2026-09-03", source: "qr" });
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("button", { name: "Показать", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
  expect(errors).toEqual([]);
  await page.locator("#logout").click();
  await expect(page).toHaveURL(/\/test\/access\/login/);
  expect(await page.evaluate(() => sessionStorage.getItem("kanata_admin_token"))).toBeNull();
});

test("an expired Access session cannot reopen the panel from history", async ({ page, context }) => {
  await page.route(`${API}/**`, route => route.fulfill({json:report(route.request().url())}));
  await page.goto('/stat-panel/');
  await expect(page.locator('#report')).toBeVisible();
  await context.clearCookies();
  await page.reload();
  await expect(page).toHaveURL(/\/test\/access\/login/);
  await page.goto('/stat-panel/earnings');
  await expect(page).toHaveURL(/\/test\/access\/login/);
});

test("API outage shows an error without synthetic data", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("kanata_admin_token", "test-token"));
  await page.route(`${API}/**`, route => route.fulfill({ status: 503, headers: { "Access-Control-Allow-Origin": "http://127.0.0.1:8787" }, json: { error: "unavailable" } }));
  await page.goto("/stat-panel/");
  await expect(page.locator("#message")).toContainText("Не удалось загрузить статистику");
  await expect(page.locator("#report")).toBeHidden();
});
