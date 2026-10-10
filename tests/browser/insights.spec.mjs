import {test, expect} from '@playwright/test';
import {trafficReport, earning} from '../support/insights-fixtures.mjs';

const API = 'https://dupt8l46y1.execute-api.eu-north-1.amazonaws.com';
const headers = {'Access-Control-Allow-Origin': 'http://127.0.0.1:8787', 'Access-Control-Allow-Headers': 'authorization,content-type', 'Access-Control-Allow-Methods': 'GET,OPTIONS'};

async function mockAPIs(page, {entries = [], failure = null, delayFirst = false} = {}) {
  const seen = [];
  let first = true;
  await page.route(API + '/**', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({status: 204, headers});
    expect(route.request().headers().authorization).toBe('Bearer test-token');
    const range = Object.fromEntries(new URL(route.request().url()).searchParams);
    seen.push(range);
    if (failure === 'auth') return route.fulfill({status: 403, headers, json: {error: 'expired'}});
    const wait = first && delayFirst;
    first = false;
    if (wait) await new Promise(resolve => setTimeout(resolve, 700));
    const report = trafficReport(range.from, range.to);
    if (failure === 'traffic') report.totals.page_views++;
    try { await route.fulfill({headers, json: report}); } catch (error) { if (!wait) throw error; }
  });
  await page.route('**/earnings-api/**', async route => {
    const url = new URL(route.request().url());
    expect(route.request().method()).toBe('GET');
    if (failure === 'earnings') return route.fulfill({status: 503, json: {error: 'unavailable'}});
    const result = url.pathname.endsWith('/spots') ? {spots: [{id: 'spot-a', name: 'Anděl'}]}
      : {entries: entries.filter(entry => entry.date >= url.searchParams.get('from') && entry.date <= url.searchParams.get('to'))};
    await route.fulfill({json: result});
  });
  return seen;
}

test.beforeEach(async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-10-09T20:00:00Z'));
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('__test_initialized')) {
      sessionStorage.setItem('kanata_admin_token', 'test-token');
      sessionStorage.setItem('__test_initialized', 'true');
    }
    window.violations = [];
    document.addEventListener('securitypolicyviolation', event => window.violations.push(event.violatedDirective));
  });
});

test('insights combines real API-shaped data, all 92 days, weekly sums and accessible tooltips', async ({page}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const seen = await mockAPIs(page, {entries: [earning('2026-07-02', 'a', '1600', '12:00', '16:00'), earning('2026-07-06', 'b', '600', '12:00', '13:00')]});
  await page.goto('/stat-panel/insights');
  await expect(page.locator('#views-value')).toHaveText('240');
  expect(await page.locator('.insights-metrics .metric').count()).toBe(5);
  const before = seen.length;
  await page.locator('#from').fill('2026-07-01');
  await page.locator('#to').fill('2026-09-30');
  expect(seen.length).toBe(before);
  await page.locator('#show').click();
  await expect(page.locator('#views-value')).toHaveText('736');
  await expect(page.locator('#total-czk')).toHaveText('2 200 Kč');
  await expect(page.locator('#hour-czk')).toHaveText('440 Kč/ч');
  await expect(page.locator('#youtube-value')).toHaveText('92');
  await expect(page.locator('#instagram-value')).toHaveText('184');
  await expect(page.locator('.chart-income')).toHaveCount(92);
  expect(seen.slice(before)).toEqual([{from: '2026-07-01', to: '2026-09-28', source: 'all'}, {from: '2026-09-29', to: '2026-09-30', source: 'all'}]);
  await page.locator('[data-group="weeks"]').click();
  await expect(page.locator('.chart-income')).toHaveCount(14);
  await expect(page.locator('#views-value')).toHaveText('736');
  await expect(page.locator('#total-czk')).toHaveText('2 200 Kč');
  expect(seen.length).toBe(before + 2);
  await page.locator('#insights-chart').focus();
  await page.keyboard.press('Home');
  await expect(page.locator('#chart-tooltip')).toContainText('5 июля');
  await expect(page.locator('#chart-tooltip')).toContainText('1 600 Kč');
  await expect(page.locator('#chart-tooltip dd').nth(1)).toHaveText('40');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#chart-tooltip')).toContainText('12 июля');
  await page.keyboard.press('Escape');
  await expect(page.locator('#chart-tooltip')).toBeHidden();
  await page.locator('[data-group="days"]').click();
  await expect(page.locator('.chart-income')).toHaveCount(92);
  for (const width of [1440, 1000, 780, 700, 430, 414, 390, 381, 380, 320]) {
    await page.setViewportSize({width, height: 1000});
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width <= 760) {
      expect(await page.evaluate(() => {
        const from = document.querySelector('#from').getBoundingClientRect(), to = document.querySelector('#to').getBoundingClientRect();
        const panel = document.querySelector('#filters').getBoundingClientRect();
        const separate = innerWidth <= 380 ? to.top >= from.bottom + 10 : to.left >= from.right + 19;
        return separate && from.left >= panel.left && to.right <= panel.right && from.width > 0 && to.width > 0;
      })).toBe(true);
    }
  }
  await page.emulateMedia({colorScheme: 'dark'});
  expect(await page.evaluate(() => window.violations)).toEqual([]);
  expect(errors).toEqual([]);
});

test('earnings copies Visits date/period controls, restores range and queries the selected date', async ({page}) => {
  await mockAPIs(page, {entries: [earning('2026-10-03')]});
  await page.goto('/stat-panel/earnings');
  await expect(page.locator('#entries-body tr')).toHaveCount(1);
  await expect(page.locator('[data-mode="period"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#from').fill('2026-10-01');
  await page.locator('#to').fill('2026-10-07');
  await page.locator('#show').click();
  await expect(page.locator('#report')).toBeVisible();
  await page.locator('[data-mode="day"]').click();
  await expect(page.locator('#date-calendar')).toBeVisible();
  await page.locator('[data-date="2026-10-03"]').click();
  await expect(page.locator('#date-value')).toContainText('3 октября');
  await expect(page.locator('#from')).toHaveValue('2026-10-03');
  await expect(page.locator('#to')).toHaveValue('2026-10-03');
  await expect(page.locator('#range-fields')).toBeHidden();
  await expect(page.locator('#entries-body tr')).toHaveCount(1);
  await page.locator('[data-mode="period"]').click();
  await expect(page.locator('#from')).toHaveValue('2026-10-01');
  await expect(page.locator('#to')).toHaveValue('2026-10-07');
  await page.locator('[data-days="1"]').click();
  await expect(page.locator('#date-value')).toContainText('9 октября');
  await expect(page.locator('#empty')).toBeVisible();
  for (const width of [1440, 700, 390, 320]) {
    await page.setViewportSize({width, height: 900});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.emulateMedia({colorScheme: 'dark'});
  expect(await page.evaluate(() => window.violations)).toEqual([]);
});

test('insights selects a past day in the shared calendar and restores the exact three-month range', async ({page}) => {
  const seen = await mockAPIs(page, {entries: [earning('2026-10-03')]});
  await page.goto('/stat-panel/insights');
  await expect(page.locator('#views-value')).toHaveText('240');
  await expect(page.locator('[data-mode="period"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-months="3"]').click();
  await expect(page.locator('#from')).toHaveValue('2026-07-10');
  await expect(page.locator('#to')).toHaveValue('2026-10-09');
  await expect(page.locator('#views-value')).toHaveText('736');
  await page.locator('[data-mode="day"]').click();
  await expect(page.locator('#date-calendar')).toBeVisible();
  await expect(page.locator('[data-date="2026-10-10"]')).toBeDisabled();
  await page.locator('[data-date="2026-10-03"]').click();
  await expect(page.locator('#date-calendar')).toBeHidden();
  await expect(page.locator('#open-calendar')).toBeFocused();
  await expect(page.locator('#date-value')).toContainText('3 октября 2026');
  await expect(page.locator('#range-fields')).toBeHidden();
  await expect(page.locator('#from')).toBeDisabled();
  await expect(page.locator('#from')).toHaveValue('2026-10-03');
  await expect(page.locator('#to')).toHaveValue('2026-10-03');
  await expect(page.locator('#views-value')).toHaveText('8');
  await expect(page.locator('#total-czk')).toHaveText('220 Kč');
  expect(seen.at(-1)).toEqual({from:'2026-10-03',to:'2026-10-03',source:'all'});
  await page.locator('#open-calendar').click();
  await page.locator('#calendar-month').selectOption('8');
  await page.locator('[data-date="2026-09-12"]').click();
  await expect(page.locator('#date-value')).toContainText('12 сентября');
  await expect(page.locator('#total-czk')).toHaveText('0 Kč');
  await page.locator('[data-mode="period"]').click();
  await expect(page.locator('#from')).toBeEnabled();
  await expect(page.locator('#from')).toHaveValue('2026-07-10');
  await expect(page.locator('#to')).toHaveValue('2026-10-09');
  await expect(page.locator('[data-months="3"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#views-value')).toHaveText('736');
  await page.locator('[data-days="1"]').click();
  await expect(page.locator('[data-mode="day"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#date-value')).toContainText('9 октября');
  await expect(page.locator('#views-value')).toHaveText('8');
  expect(await page.evaluate(()=>window.violations)).toEqual([]);
});

for (const failure of ['traffic', 'earnings']) test(`insights hides the combined report on ${failure} errors`, async ({page}) => {
  await mockAPIs(page, {failure});
  await page.goto('/stat-panel/insights');
  await expect(page.locator('#message')).toHaveAttribute('role', 'alert');
  await expect(page.locator('#report')).toBeHidden();
  await expect(page.locator('#insights-chart svg')).toHaveCount(0);
  await expect(page.locator('#show')).toBeEnabled();
});

test('insights expires unauthorized sessions and rejects future dates before requesting data', async ({page}) => {
  const seen = await mockAPIs(page);
  await page.goto('/stat-panel/insights');
  await expect(page.locator('#report')).toBeVisible();
  const before = seen.length;
  await page.locator('#to').fill('2026-10-10');
  // Bypass native validation to exercise the application range guard too.
  await page.locator('#filters').evaluate(form => form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true})));
  await expect(page.locator('#message')).toContainText('сегодняшнего дня');
  expect(seen.length).toBe(before);
  await page.locator('#logout').click();
  await expect(page).toHaveURL(/login/);
  expect(await page.evaluate(() => sessionStorage.getItem('kanata_admin_token'))).toBeNull();
  await page.goto('/stat-panel/insights');
  await expect(page).toHaveURL(/login/);
  await page.evaluate(() => sessionStorage.setItem('kanata_admin_token', 'test-token'));
  await mockAPIs(page, {failure: 'auth'});
  await page.goto('/stat-panel/insights');
  await expect(page).toHaveURL(/login/);
  expect(await page.evaluate(() => sessionStorage.getItem('kanata_admin_token'))).toBeNull();
});

test('a slow earlier report cannot overwrite the next selected period', async ({page}) => {
  await mockAPIs(page, {delayFirst: true});
  await page.goto('/stat-panel/insights');
  await page.locator('[data-days="1"]').click();
  await expect(page.locator('#views-value')).toHaveText('8');
  await expect(page.locator('.chart-income')).toHaveCount(1);
  await page.waitForTimeout(800);
  await expect(page.locator('#views-value')).toHaveText('8');
});
