import {test, expect} from '../support/browser.mjs';
import {earning, trafficReport} from '../support/insights-fixtures.mjs';
import {convert} from '../../statistics-panel/earnings-model.js';

test.use({timezoneId: 'America/Los_Angeles'});

async function mockData(page, {entries = [], spots = [{id: 'spot-a', name: 'Точка A'}], failSpots = false} = {}) {
  const calls = {entries: 0, spots: 0, traffic: 0};
  await page.route('**/api/stats?**', async route => {
    calls.traffic++;
    const query = new URL(route.request().url()).searchParams;
    await route.fulfill({json: trafficReport(query.get('from'), query.get('to'))});
  });
  await page.route('**/earnings-api/**', async route => {
    const url = new URL(route.request().url());
    expect(route.request().method()).toBe('GET');
    if (url.pathname.endsWith('/calendar')) return route.fulfill({json: {year: Number(url.searchParams.get('year')), days: []}});
    if (url.pathname.endsWith('/spots')) {
      calls.spots++;
      return failSpots ? route.fulfill({status: 503, json: {error: 'unavailable'}}) : route.fulfill({json: {spots}});
    }
    calls.entries++;
    await route.fulfill({json: {entries: entries.filter(entry => entry.date >= url.searchParams.get('from') && entry.date <= url.searchParams.get('to') && (!url.searchParams.get('spot') || entry.spotId === url.searchParams.get('spot')))}});
  });
  return calls;
}

function sampleEntries() {
  const mixed = earning('2026-10-08', 'mixed', '0');
  mixed.snapshot.rates.PLN = 6;
  mixed.amounts = [{currency: 'CZK', minor: 10000}, {currency: 'EUR', minor: 200}, {currency: 'USD', minor: 100}, {currency: 'PLN', minor: 300}];
  Object.assign(mixed, convert(mixed.amounts, mixed.snapshot));
  return [mixed, earning('2026-09-28', 'long-monday', '180', '12:00', '15:00'),
    earning('2026-10-05', 'short-monday', '120', '12:00', '13:00'), earning('2026-10-09', 'friday', '95')];
}

test.beforeEach(async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-10-18T12:00:00Z'));
  await page.addInitScript(() => {
    window.violations = [];
    document.addEventListener('securitypolicyviolation', event => window.violations.push(event.violatedDirective));
  });
});

test('earnings shows a weekday directly after every date without expanding the mobile page', async ({page}) => {
  await mockData(page, {entries: ['2026-10-09', '2026-10-04', '2026-10-03'].map(date => earning(date))});
  await page.goto('/stat-panel/earnings');
  await expect(page.locator('#entries-table thead th').nth(1)).toHaveText('День недели');
  await expect(page.locator('#entries-body .entry-weekday')).toHaveText(['Пятница', 'Воскресенье', 'Суббота']);
  await expect(page.locator('#entries-body tr').first().locator('td').nth(0)).toHaveText('09.10.2026');
  await expect(page.locator('#entries-body tr').first().locator('td').nth(2)).toContainText('14:00–16:00');
  await page.locator('.performances').screenshot({path: 'test-results/weekday-earnings-desktop.png'});
  for (const width of [1440, 1000, 780, 390, 320]) {
    await page.setViewportSize({width, height: 1000});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.locator('.performances').screenshot({path: 'test-results/weekday-earnings-mobile.png'});
  expect(await page.evaluate(() => window.violations)).toEqual([]);
});

test('earnings ranks weighted hourly earnings before the performances, with one fixed spot and the selected period', async ({page}) => {
  await mockData(page, {entries: sampleEntries()});
  await page.goto('/stat-panel/earnings');
  await expect(page.locator('#weekday-ranking li')).toHaveCount(7);
  await expect(page.locator('#weekday-spot')).toBeHidden();
  await expect(page.locator('#weekday-spot')).toBeDisabled();
  await expect(page.locator('#weekday-only-spot')).toHaveText('Точка A');
  await expect(page.locator('.weekday-name')).toHaveText(['Четверг', 'Понедельник', 'Пятница', 'Вторник', 'Среда', 'Суббота', 'Воскресенье']);
  await expect(page.locator('.weekday-rate')).toHaveText(['94 Kč/ч', '75 Kč/ч', '47,5 Kč/ч', '0 Kč/ч', '0 Kč/ч', '0 Kč/ч', '0 Kč/ч']);
  await expect(page.locator('.weekday-count')).toHaveText(['1', '2', '1', '0', '0', '0', '0']);
  await expect(page.locator('[data-weekday="0"] .weekday-count')).toHaveAttribute('aria-label', 'Выступлений: 2');
  expect(await page.locator('.weekday-panel').evaluate(panel => panel.getBoundingClientRect().top >= document.querySelector('.daily-panel').getBoundingClientRect().bottom)).toBe(true);
  await page.locator('#from').fill('2026-10-05');
  await page.locator('#to').fill('2026-10-09');
  await page.locator('#show').click();
  await expect(page.locator('.weekday-name').first()).toHaveText('Понедельник');
  await expect(page.locator('.weekday-rate').first()).toHaveText('120 Kč/ч');
  await expect(page.locator('[data-weekday="0"] .weekday-count')).toHaveText('1');
  expect(await page.evaluate(() => window.violations)).toEqual([]);
});

test('multiple registered spots can be switched locally, keep their selection and fit desktop and mobile', async ({page}) => {
  const spots = [{id: 'spot-a', name: 'Точка A'}, {id: 'spot-b', name: 'Точка B'}, {id: 'spot-c', name: 'Точка с длинным названием без выступлений за выбранный период'}];
  const calls = await mockData(page, {spots, entries: [...sampleEntries(), {...earning('2026-10-06', 'other', '900', '12:00', '13:00'), spotId: 'spot-b'}]});
  await page.goto('/stat-panel/earnings');
  await expect(page.locator('#weekday-spot')).toBeVisible();
  await expect(page.locator('#weekday-spot option')).toHaveCount(3);
  await expect(page.locator('#weekday-only-spot')).toBeHidden();
  await expect(page.locator('.weekday-rate').first()).toHaveText('94 Kč/ч');
  const totals = await page.locator('.earnings-metrics').innerText(), before = {...calls};
  await page.locator('#weekday-spot').selectOption('spot-b');
  await expect(page.locator('.weekday-name').first()).toHaveText('Вторник');
  await expect(page.locator('.weekday-rate').first()).toHaveText('900 Kč/ч');
  await expect(page.locator('.weekday-count')).toHaveText(['1', '0', '0', '0', '0', '0', '0']);
  expect(await page.locator('.earnings-metrics').innerText()).toBe(totals);
  expect(calls).toEqual(before);
  await page.locator('#show').click();
  await expect(page.locator('#weekday-spot')).toHaveValue('spot-b');
  await expect(page.locator('.weekday-rate').first()).toHaveText('900 Kč/ч');
  await expect(page.locator('.weekday-count')).toHaveText(['1', '0', '0', '0', '0', '0', '0']);
  await page.locator('#weekday-spot').selectOption('spot-c');
  await expect(page.locator('.weekday-rate')).toHaveText(Array(7).fill('0 Kč/ч'));
  await expect(page.locator('#weekday-empty')).toBeVisible();
  await expect(page.locator('.weekday-count')).toHaveText(Array(7).fill('0'));
  await page.locator('#weekday-spot').selectOption('spot-a');
  await expect(page.locator('.weekday-rate').first()).toHaveText('94 Kč/ч');
  await page.locator('.weekday-panel').screenshot({path: 'test-results/weekday-insights-desktop.png'});
  for (const width of [1440, 1000, 780, 700, 390, 320]) {
    await page.setViewportSize({width, height: 1000});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.weekday-panel').evaluate(panel => [...panel.querySelectorAll('.weekday-name,.weekday-rate,.weekday-count,select')].every(element => {
      const rect = element.getBoundingClientRect(), box = panel.getBoundingClientRect();
      return rect.left >= box.left && rect.right <= box.right;
    }))).toBe(true);
    expect(await page.locator('.weekday-track').evaluateAll(tracks => tracks.every(track => {
      const count = track.querySelector('.weekday-count').getBoundingClientRect(), bar = track.querySelector('progress').getBoundingClientRect();
      return count.right + 9 <= bar.left && Math.abs((count.top + count.bottom) / 2 - (bar.top + bar.bottom) / 2) < 1;
    }))).toBe(true);
  }
  await page.locator('.weekday-panel').screenshot({path: 'test-results/weekday-insights-mobile.png'});
  await page.emulateMedia({colorScheme: 'dark'});
  await page.locator('.weekday-panel').screenshot({path: 'test-results/weekday-insights-mobile-dark.png'});
  expect(await page.evaluate(() => window.violations)).toEqual([]);
});

for (const spots of [[], [{id: 'spot-a', name: 'Точка A'}]]) test(`empty earnings show seven zeros and no invented spot choices (${spots.length} spots)`, async ({page}) => {
  await mockData(page, {spots});
  await page.goto('/stat-panel/earnings');
  await expect(page.locator('#report')).toBeVisible();
  await expect(page.locator('#weekday-spot')).toBeHidden();
  await expect(page.locator('.weekday-name')).toHaveText(['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']);
  await expect(page.locator('.weekday-rate')).toHaveText(Array(7).fill('0 Kč/ч'));
  await expect(page.locator('#weekday-empty')).toBeVisible();
  await expect(page.locator('.weekday-count')).toHaveText(Array(7).fill('0'));
});

test('a failed spot request hides the report instead of displaying misleading zero rates', async ({page}) => {
  await mockData(page, {entries: sampleEntries(), failSpots: true});
  await page.goto('/stat-panel/earnings');
  await expect(page.locator('#message')).toHaveClass(/error/);
  await expect(page.locator('#report')).toBeHidden();
  await expect(page.locator('#show')).toBeEnabled();
});
