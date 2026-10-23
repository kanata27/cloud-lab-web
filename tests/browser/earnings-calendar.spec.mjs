import {test, expect, openEarningsDetails} from '../support/browser.mjs';
import {trafficReport, earning} from '../support/insights-fixtures.mjs';

function calendarData(year) {
  return {year, days: year === 2026 ? [
    {date: '2026-01-02', czkMinor: 10000, eurMinor: 400, minutes: 60, count: 1, spots: ['Точка A']},
    {date: '2026-09-28', czkMinor: 40000, eurMinor: 1600, minutes: 480, count: 2, spots: ['Точка A']},
    {date: '2026-10-09', czkMinor: 31500, eurMinor: 1260, minutes: 180, count: 2, spots: ['Точка A', 'Точка B']},
    {date: '2026-10-10', czkMinor: 0, eurMinor: 0, minutes: 60, count: 1, spots: ['Точка A']},
  ] : year === 2024 ? [
    {date: '2024-01-01', czkMinor: 10000, eurMinor: 400, minutes: 60, count: 1, spots: ['Точка A']},
    {date: '2024-02-29', czkMinor: 20000, eurMinor: 800, minutes: 120, count: 2, spots: ['Точка A']},
    {date: '2024-12-31', czkMinor: 6000, eurMinor: 240, minutes: 60, count: 1, spots: ['Точка A']},
  ] : []};
}

async function mockAPIs(page) {
  const years = [];
  const state = {failure: null, delayed: null, corrupt: false};
  await page.route('**/api/stats?**', route => {
    const query = new URL(route.request().url()).searchParams;
    return route.fulfill({json: trafficReport(query.get('from'), query.get('to'))});
  });
  await page.route('**/earnings-api/**', async route => {
    const url = new URL(route.request().url()), query = url.searchParams;
    expect(route.request().method()).toBe('GET');
    if (url.pathname.endsWith('/calendar')) {
      const year = Number(query.get('year')); years.push(year);
      if (state.delayed === year) await new Promise(resolve => setTimeout(resolve, 500));
      const status = state.failure || 200;
      try { return await route.fulfill({status, json: state.corrupt ? {entries: []} : calendarData(year)}); }
      catch (error) { if (state.delayed !== year) throw error; return; }
    }
    if (url.pathname.endsWith('/spots')) return route.fulfill({json: {spots: [{id: 'spot-a', name: 'Точка A'}]}});
    return route.fulfill({json: {entries: [earning('2026-10-09')].filter(entry => entry.date >= query.get('from') && entry.date <= query.get('to'))}});
  });
  return {years, state};
}

test.beforeEach(async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-10-18T12:00:00Z'));
  await page.addInitScript(() => {
    window.violations = [];
    document.addEventListener('securitypolicyviolation', event => window.violations.push(event.violatedDirective));
  });
});

test('annual heatmap shows the whole year, uses hourly intensity and stays independent of the period filter', async ({page}) => {
  const {years} = await mockAPIs(page), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/stat-panel/earnings');await openEarningsDetails(page);
  await expect(page.locator('#report')).toBeVisible();
  await expect(page.locator('#annual-report')).toBeVisible();
  await expect(page.locator('#annual-year')).toHaveValue('2026');
  await expect(page.locator('#annual-year option')).toHaveText(['2026', '2025', '2024']);
  await expect(page.locator('.annual-day')).toHaveCount(365);
  await expect(page.locator('.annual-day').first()).toHaveAttribute('data-date', '2026-01-01');
  await expect(page.locator('.annual-day').last()).toHaveAttribute('data-date', '2026-12-31');
  await expect(page.locator('#annual-months span')).toHaveText(['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']);
  await expect(page.locator('#annual-days [data-date="2026-09-28"]')).toHaveAttribute('data-level', '2');
  await expect(page.locator('#annual-days [data-date="2026-10-09"]')).toHaveAttribute('data-level', '4');
  await expect(page.locator('#annual-days [data-date="2026-10-09"]')).toHaveAttribute('data-hour', '105');
  await expect(page.locator('#annual-days [data-date="2026-10-10"]')).toHaveAttribute('data-level', '1');
  await expect(page.locator('#annual-days [data-date="2026-10-11"]')).toHaveAttribute('data-level', '0');
  await expect(page.locator('#annual-days [data-date="2026-10-19"]')).toBeDisabled();
  await expect(page.locator('#annual-days [aria-current="date"]')).toHaveAttribute('data-date', '2026-10-18');
  await expect(page.locator('#annual-summary')).toHaveText('Дней с выступлениями: 4');
  expect(await page.locator('#annual-panel').evaluate(panel => panel.getBoundingClientRect().top >= document.querySelector('.weekday-panel').getBoundingClientRect().bottom)).toBe(true);
  await page.locator('#annual-days [data-date="2026-10-09"]').hover();
  await expect(page.locator('#annual-tooltip')).toBeVisible();
  await expect(page.locator('#annual-tooltip')).toContainText('105 Kč (4,2 €)');
  await expect(page.locator('#annual-tooltip dd')).toHaveText(['105 Kč (4,2 €)', '315 Kč (12,6 €)', '3 ч', 'Точка A · Точка B']);
  await expect(page.locator('#annual-tooltip dt')).toHaveText(['За час', 'Всего', 'Время', 'Точки']);
  await page.locator('#annual-days [data-date="2026-01-02"]').hover();
  await expect(page.locator('#annual-tooltip dd')).toHaveText(['100 Kč (4 €)', '100 Kč (4 €)', '1 ч', 'Точка A']);
  await expect(page.locator('#annual-tooltip dt')).toHaveText(['За час', 'Всего', 'Время', 'Точка']);
  await page.locator('#from').fill('2026-10-01');await page.locator('#to').fill('2026-10-02');await page.locator('#show').click();
  await expect(page.locator('#report')).toBeVisible();
  await expect(page.locator('#total-czk')).toHaveText('0 Kč');
  await expect(page.locator('.annual-day')).toHaveCount(365);
  await expect(page.locator('#annual-summary')).toHaveText('Дней с выступлениями: 4');
  expect(years).toEqual([2026]);
  await page.locator('#annual-panel').screenshot({path: 'test-results/annual-calendar-desktop.png'});
  const totals = await page.locator('.earnings-metrics').innerText();
  await page.locator('#annual-year').selectOption('2024');
  await expect(page.locator('.annual-day')).toHaveCount(366);
  await expect(page.locator('#annual-days [data-date="2024-02-29"]')).toHaveCount(1);
  await expect(page.locator('.annual-day:disabled')).toHaveCount(0);
  expect(await page.locator('.earnings-metrics').innerText()).toBe(totals);
  await page.locator('#annual-year').selectOption('2025');
  await expect(page.locator('.annual-day')).toHaveCount(365);
  await expect(page.locator('#annual-summary')).toHaveText('Дней с выступлениями: 0');
  await expect(page.locator('.annual-day[data-level="0"]')).toHaveCount(365);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.violations)).toEqual([]);
});

test('keyboard navigation and a horizontally scrolling mobile calendar keep every day and tooltip accessible', async ({page}) => {
  await mockAPIs(page);
  await page.goto('/stat-panel/earnings');await openEarningsDetails(page);
  await expect(page.locator('#annual-report')).toBeVisible();
  await page.locator('#annual-year').selectOption('2024');
  await expect(page.locator('.annual-day')).toHaveCount(366);
  for (const width of [1440, 1000, 780, 414, 390, 320]) {
    await page.setViewportSize({width, height: 1000});
    await page.locator('#annual-days [tabindex="0"]').focus();
    await page.keyboard.press('Home');
    await expect(page.locator('#annual-days [data-date="2024-01-01"]')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#annual-days [data-date="2024-01-08"]')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#annual-days [data-date="2024-01-09"]')).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.locator('#annual-days [data-date="2024-12-31"]')).toBeFocused();
    await expect(page.locator('#annual-tooltip')).toContainText('60 Kč (2,4 €)');
    expect(await page.locator('#annual-tooltip').evaluate(tooltip => {
      const box = tooltip.getBoundingClientRect();return box.left >= 8 && box.right <= innerWidth - 8 && box.top >= 8 && box.bottom <= innerHeight - 8;
    })).toBe(true);
    await expect(page.locator('#annual-days [tabindex="0"]')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width <= 780) expect(await page.locator('#annual-scroll').evaluate(scroll => scroll.scrollWidth > scroll.clientWidth)).toBe(true);
    await page.keyboard.press('Escape');await expect(page.locator('#annual-tooltip')).toBeHidden();
  }
  await page.locator('#annual-panel').screenshot({path: 'test-results/annual-calendar-mobile.png'});
  await page.emulateMedia({colorScheme: 'dark'});
  await page.locator('#annual-panel').screenshot({path: 'test-results/annual-calendar-mobile-dark.png'});
  expect(await page.evaluate(() => window.violations)).toEqual([]);
});

test.describe('touch', () => {
  test.use({hasTouch: true, viewport: {width: 390, height: 844}});
  test('tapping a day opens its details and tapping outside dismisses them', async ({page}) => {
    await mockAPIs(page);await page.goto('/stat-panel/earnings');await openEarningsDetails(page);
    await expect(page.locator('#annual-report')).toBeVisible();
    await page.locator('#annual-days [data-date="2026-10-09"]').tap();
    await expect(page.locator('#annual-tooltip')).toContainText('105 Kč (4,2 €)');
    await page.locator('#annual-title').tap();
    await expect(page.locator('#annual-tooltip')).toBeHidden();
  });
});

test('a late year response cannot replace the newer selection; errors keep the main report and can be retried', async ({page}) => {
  const {state, years} = await mockAPIs(page);
  await page.goto('/stat-panel/earnings');await openEarningsDetails(page);await expect(page.locator('#annual-report')).toBeVisible();
  state.delayed = 2024;
  await page.locator('#annual-year').selectOption('2024');
  await expect.poll(() => years.includes(2024)).toBe(true);
  await page.locator('#annual-year').selectOption('2025');
  await expect(page.locator('.annual-day').first()).toHaveAttribute('data-date', '2025-01-01');
  await expect(page.locator('#annual-summary')).toHaveText('Дней с выступлениями: 0');
  await page.waitForTimeout(600);
  await expect(page.locator('.annual-day').first()).toHaveAttribute('data-date', '2025-01-01');
  state.failure = 503;
  await page.locator('#annual-year').selectOption('2026');
  await expect(page.locator('#annual-message')).toHaveAttribute('role', 'alert');
  await expect(page.locator('#annual-report')).toBeHidden();
  await expect(page.locator('#report')).toBeVisible();
  await expect(page.locator('#annual-retry')).toBeVisible();
  state.failure = null;
  await page.locator('#annual-retry').click();
  await expect(page.locator('#annual-report')).toBeVisible();
  await expect(page.locator('.annual-day')).toHaveCount(365);
  state.corrupt = true;
  await page.locator('#annual-year').selectOption('2025');
  await expect(page.locator('#annual-message')).toHaveAttribute('role', 'alert');
  await expect(page.locator('#annual-report')).toBeHidden();
  await expect(page.locator('#report')).toBeVisible();
});

for (const [status, reason] of [[401, 'expired'], [403, 'denied']]) test(`an unauthorized calendar request (${status}) closes the whole private panel`, async ({page}) => {
  const {state} = await mockAPIs(page);
  await page.goto('/stat-panel/earnings');await openEarningsDetails(page);await expect(page.locator('#annual-report')).toBeVisible();
  state.failure = status;
  await page.locator('#annual-year').selectOption('2025');
  await expect(page).toHaveURL(new RegExp('/panel-login/\\?reason=' + reason));
});
