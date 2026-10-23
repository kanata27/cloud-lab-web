import {test, expect, openEarningsDetails} from '../support/browser.mjs';
import {earning} from '../support/insights-fixtures.mjs';
import {convert} from '../../statistics-panel/earnings-model.js';

const asOf = '2026-10-19';
const currentRates = {CZK: 1, EUR: 24.342, USD: 21.72, JPY: .14, GBP: 28.5, PLN: 5.7, CHF: 26, HUF: .062};
function snapshot(date = asOf) {
  return {requestedDate: date, source: 'Frankfurter / ECB', rates: {...currentRates},
    dates: Object.fromEntries(Object.keys(currentRates).map(currency => [currency, '2026-10-16']))};
}
function record(date, id, {CZK = 100, EUR = 0, USD = 0, ...other} = {}, spotId = 'spot-a') {
  const entry = earning(date, id, String(CZK));
  entry.spotId = spotId;
  entry.amounts = Object.entries({CZK, EUR, USD, ...other}).map(([currency, value]) => ({currency, minor: Math.round(value * 100)}));
  entry.snapshot.rates = {CZK: 1, EUR: 25, USD: 20, JPY: .2, GBP: 30, PLN: 6, CHF: 27, HUF: .07};
  Object.assign(entry, convert(entry.amounts, entry.snapshot));
  return entry;
}

async function mockAPIs(page, entries = []) {
  const state = {entries, rateStatus: 200, requests: [], delayedFirst: false, missingYen: false};
  await page.route('**/earnings-api/**', async route => {
    const url = new URL(route.request().url()), query = url.searchParams;
    if (url.pathname.endsWith('/rates')) {
      const date = query.get('date'); state.requests.push(date);
      const data = snapshot(date), delayed = state.delayedFirst && state.requests.length === 1;
      if (delayed) { data.rates.EUR = 100; await new Promise(resolve => setTimeout(resolve, 650)); }
      if (state.missingYen) delete data.rates.JPY;
      try { return await route.fulfill({status: state.rateStatus, json: state.rateStatus === 200 ? data : {error: 'unavailable'}}); }
      catch (error) { if (!delayed) throw error; return; }
    }
    if (url.pathname.endsWith('/spots')) return route.fulfill({json: {spots: [{id: 'spot-a', name: 'Точка A'}, {id: 'spot-b', name: 'Точка B'}]}});
    const selected = state.entries.filter(entry => entry.date >= query.get('from') && entry.date <= query.get('to')
      && (!query.get('spot') || entry.spotId === query.get('spot')));
    const offset = Number(query.get('cursor') || 0);
    return route.fulfill({json: {entries: selected.slice(offset, offset + 1), nextCursor: offset + 1 < selected.length ? String(offset + 1) : null}});
  });
  return state;
}

test.beforeEach(async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-10-19T12:00:00Z'));
  await page.addInitScript(() => {
    window.violations = [];
    document.addEventListener('securitypolicyviolation', event => window.violations.push(event.violatedDirective));
  });
});

test('original foreign amounts respect the period and spot, show the latest actual rate date, and keep historical totals', async ({page}) => {
  const state = await mockAPIs(page, [record('2026-10-18', 'yesterday', {CZK: 100, EUR: 3}),
    record('2026-10-17', 'previous', {CZK: 50, EUR: 2.5}, 'spot-b'), record('2026-08-01', 'outside', {EUR: 99})]);
  await page.goto('/stat-panel/earnings');await openEarningsDetails(page);
  await expect(page.locator('#foreign-currencies')).toBeVisible();
  await expect(page.locator('.foreign-currency')).toHaveCount(1);
  await expect(page.locator('[data-currency="EUR"] .currency-original')).toHaveText('5,50 €');
  await expect(page.locator('[data-currency="EUR"] .currency-equivalent')).toHaveText('(≈ 133,88 Kč)');
  await expect(page.locator('#currency-quote-date')).toHaveText('Курс от 16.10.2026');
  await expect(page.locator('#total-czk')).toHaveText('287,5 Kč');
  await expect(page.locator('#currency-toggle')).toBeHidden();
  expect(state.requests).toEqual([asOf]);
  expect(await page.locator('#foreign-currencies').evaluate(panel => {
    const box = panel.getBoundingClientRect();
    return box.top >= document.querySelector('.charts').getBoundingClientRect().bottom
      && box.bottom <= document.querySelector('.performances').getBoundingClientRect().top;
  })).toBe(true);
  await page.locator('#filter-spot').selectOption('spot-b'); await page.locator('#show').click();
  await expect(page.locator('.currency-original')).toHaveText('2,50 €');
  await expect(page.locator('.currency-equivalent')).toHaveText('(≈ 60,86 Kč)');
  await expect(page.locator('#total-czk')).toHaveText('112,5 Kč');
  await page.locator('#from').fill('2026-10-18'); await page.locator('#to').fill('2026-10-18'); await page.locator('#show').click();
  await expect(page.locator('#report')).toBeVisible();
  await expect(page.locator('#foreign-currencies')).toBeHidden();
  state.entries = [record('2026-10-18', 'changed', {CZK: 50, USD: 2})];
  await page.locator('#filter-spot').selectOption(''); await page.locator('#show').click();
  await expect(page.locator('.currency-code')).toHaveText('USD');
  await expect(page.locator('.currency-original')).toHaveText('2,00 $');
  await expect(page.locator('.currency-equivalent')).toHaveText('(≈ 43,44 Kč)');
  expect(await page.evaluate(() => window.violations)).toEqual([]);
});

test('seven currencies collapse to three, expand as 3 + 3 + 1, and fit mobile and dark mode', async ({page}) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await mockAPIs(page, [record('2026-10-18', 'all', {EUR: 5.5, USD: 6, JPY: 2000, GBP: 10, PLN: 25, CHF: 5, HUF: 1000})]);
  await page.goto('/stat-panel/earnings');await openEarningsDetails(page); await expect(page.locator('.currency-equivalent').first()).toHaveText('(≈ 133,88 Kč)');
  const totals = await page.locator('.earnings-metrics').innerText();
  await expect(page.locator('.currency-code')).toHaveText(['EUR', 'USD', 'JPY']);
  await expect(page.locator('[data-currency="JPY"] .currency-original')).toHaveText('2 000 ¥');
  await expect(page.locator('[data-currency="JPY"] .currency-equivalent')).toHaveText('(≈ 280,00 Kč)');
  await expect(page.locator('#currency-toggle')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#foreign-currencies').screenshot({path: 'test-results/currency-summary-collapsed.png'});
  await page.getByRole('button', {name: 'Показать ещё 4', exact: true}).click();
  await expect(page.locator('.currency-code')).toHaveText(['EUR', 'USD', 'JPY', 'GBP', 'PLN', 'CHF', 'HUF']);
  await expect(page.locator('#currency-toggle')).toHaveAttribute('aria-expanded', 'true');
  const rows = await page.locator('.foreign-currency').evaluateAll(items => items.map(item => {
    const box = item.getBoundingClientRect(); return {top: box.top, left: box.left};
  }));
  expect(rows[0].top).toBe(rows[2].top); expect(rows[3].top).toBe(rows[5].top);
  expect(rows[3].top).toBeGreaterThan(rows[0].top); expect(rows[6].top).toBeGreaterThan(rows[3].top);
  expect(rows[6].left).toBe(rows[0].left);
  expect(await page.locator('.earnings-metrics').innerText()).toBe(totals);
  await page.locator('#foreign-currencies').screenshot({path: 'test-results/currency-summary-expanded.png'});
  for (const width of [1440, 1100, 1000, 780, 600, 390, 320]) {
    await page.setViewportSize({width, height: 1000});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.foreign-currency').evaluateAll(items => items.every(item => {
      const box = item.getBoundingClientRect();
      return [...item.querySelectorAll('span')].every(span => {
        const child = span.getBoundingClientRect(); return child.left >= box.left && child.right <= box.right;
      });
    }))).toBe(true);
  }
  await page.locator('#foreign-currencies').screenshot({path: 'test-results/currency-summary-mobile.png'});
  await page.emulateMedia({colorScheme: 'dark'});
  await page.locator('#foreign-currencies').screenshot({path: 'test-results/currency-summary-mobile-dark.png'});
  await page.getByRole('button', {name: 'Свернуть', exact: true}).click();
  await expect(page.locator('.foreign-currency')).toHaveCount(3);
  expect(errors).toEqual([]); expect(await page.evaluate(() => window.violations)).toEqual([]);
});

for (const entries of [[], [record('2026-10-18', 'czk-only', {CZK: 100})]]) {
  test(`no currency panel or rate request for ${entries.length ? 'CZK-only' : 'empty'} reports`, async ({page}) => {
    const state = await mockAPIs(page, entries);
    await page.goto('/stat-panel/earnings');await openEarningsDetails(page); await expect(page.locator('#report')).toBeVisible();
    await expect(page.locator('#foreign-currencies')).toBeHidden(); expect(state.requests).toEqual([]);
  });
}

test('a rate outage retains original money and the main report; retry restores conversion', async ({page}) => {
  const state = await mockAPIs(page, [record('2026-10-18', 'a', {EUR: 3})]); state.rateStatus = 503;
  await page.goto('/stat-panel/earnings');await openEarningsDetails(page);
  await expect(page.locator('#currency-status')).toContainText('Не удалось получить текущий курс');
  await expect(page.locator('#report')).toBeVisible(); await expect(page.locator('.currency-original')).toHaveText('3,00 €');
  await expect(page.locator('.currency-equivalent')).toHaveText('Нет курса');
  await expect(page.locator('#total-czk')).toHaveText('175 Kč');
  state.rateStatus = 200; await page.locator('#currency-retry').click();
  await expect(page.locator('.currency-equivalent')).toHaveText('(≈ 73,03 Kč)');
  await expect(page.locator('#currency-status')).toBeHidden(); await expect(page.locator('#total-czk')).toHaveText('175 Kč');
});

test('a missing quote keeps the original currency while other available conversions stay visible', async ({page}) => {
  const state = await mockAPIs(page, [record('2026-10-18', 'a', {EUR: 3, JPY: 2000})]); state.missingYen = true;
  await page.goto('/stat-panel/earnings');await openEarningsDetails(page); await expect(page.locator('#currency-status')).toContainText('Для некоторых валют');
  await expect(page.locator('[data-currency="JPY"] .currency-original')).toHaveText('2 000 ¥');
  await expect(page.locator('[data-currency="JPY"] .currency-equivalent')).toHaveText('Нет курса');
  await expect(page.locator('[data-currency="EUR"] .currency-equivalent')).toHaveText('(≈ 73,03 Kč)');
});

test('an earlier slow quote cannot replace the next report, and refocusing after midnight refreshes the rate date', async ({page}) => {
  const state = await mockAPIs(page, [record('2026-10-18', 'a', {EUR: 3}), record('2026-10-17', 'b', {EUR: 2.5})]);
  state.delayedFirst = true;
  await page.goto('/stat-panel/earnings');await openEarningsDetails(page); await expect(page.locator('#report')).toBeVisible();
  await expect.poll(() => state.requests.length).toBe(1);
  await page.locator('#from').fill('2026-10-17'); await page.locator('#to').fill('2026-10-17'); await page.locator('#show').click();
  await expect(page.locator('.currency-equivalent')).toHaveText('(≈ 60,86 Kč)');
  await page.waitForTimeout(700); await expect(page.locator('.currency-equivalent')).toHaveText('(≈ 60,86 Kč)');
  await page.clock.setFixedTime(new Date('2026-10-20T12:00:00Z'));
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  await expect.poll(() => state.requests.at(-1)).toBe('2026-10-20');
});

for (const [status, reason] of [[401, 'expired'], [403, 'denied']]) {
  test(`unauthorized currency rates (${status}) close the private panel`, async ({page}) => {
    const state = await mockAPIs(page, [record('2026-10-18', 'a', {EUR: 3})]); state.rateStatus = status;
    await page.goto('/stat-panel/earnings');await openEarningsDetails(page); await expect(page).toHaveURL(new RegExp('/panel-login/\\?reason=' + reason));
  });
}
