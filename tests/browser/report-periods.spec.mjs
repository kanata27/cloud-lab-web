import {test, expect} from '../support/browser.mjs';
import {trafficReport, earning} from '../support/insights-fixtures.mjs';

for (const [path, kind] of [['/stat-panel/earnings', 'earnings'], ['/stat-panel/', 'visits'], ['/stat-panel/insights', 'insights']]) {
  test(`${kind}: month default, identical presets, multi-year reports and mobile filters`, async ({page}) => {
    await page.clock.setFixedTime(new Date('2026-10-18T12:00:00Z'));
    const errors = [], trafficCalls = [], entryCalls = [];
    page.on('pageerror', error => errors.push(error.message));
    const entries = [earning('2026-10-10', 'recent', '440'), earning('2026-10-09', 'middle', '330'), earning('2024-01-01', 'old', '220')];
    await page.route('**/api/stats?**', route => {
      const range = Object.fromEntries(new URL(route.request().url()).searchParams);
      trafficCalls.push(range);
      const report = trafficReport(range.from, range.to); report.range.source = range.source;
      return route.fulfill({json: report});
    });
    await page.route('**/earnings-api/**', route => {
      const url = new URL(route.request().url()), query = url.searchParams;
      if (url.pathname.endsWith('/calendar')) return route.fulfill({json: {year: Number(query.get('year')), days: []}});
      if (url.pathname.endsWith('/spots')) return route.fulfill({json: {spots: [{id: 'spot-a', name: 'Точка A'}]}});
      entryCalls.push(Object.fromEntries(query));
      const selected = entries.filter(entry => entry.date >= query.get('from') && entry.date <= query.get('to'));
      const offset = Number(query.get('cursor') || 0);
      return route.fulfill({json: {entries: selected.slice(offset, offset + 1), nextCursor: offset + 1 < selected.length ? String(offset + 1) : null}});
    });
    await page.goto(path);
    await expect(page.locator('#report')).toBeVisible();
    await expect(page.locator('#from')).toHaveValue('2026-09-19');
    await expect(page.locator('#to')).toHaveValue('2026-10-18');
    await expect(page.locator('.presets button')).toHaveText(['Сегодня', 'Неделя', 'Месяц', '3 месяца']);
    await expect(page.locator('[data-days="30"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.locator('#filters').innerText()).not.toMatch(/за запрос|До года|90 дней/);
    await page.locator('[data-months="3"]').click();
    await expect(page.locator('#report')).toBeVisible();
    await expect(page.locator('#from')).toHaveValue('2026-07-19');
    await expect(page.locator('[data-months="3"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#from').fill('2024-01-01');
    await page.locator('#show').click();
    await expect(page.locator('#report')).toBeVisible();
    if (kind === 'earnings') {
      await expect(page.locator('#entries-body tr')).toHaveCount(3);
      await expect(page.locator('#total-czk')).toHaveText('990 Kč');
      expect(entryCalls.filter(query => query.from === '2024-01-01').map(query => query.cursor || '')).toEqual(['', '1', '2']);
      await page.setViewportSize({width: 1440, height: 1000});
      const widths = await page.locator('.totals-strip .metric').evaluateAll(cards => cards.map(card => card.getBoundingClientRect().width));
      expect(widths[2]).toBeLessThanOrEqual(128); expect(widths[0]).toBeGreaterThan(widths[2] * 2);
    } else {
      const days = (Date.parse('2026-10-18') - Date.parse('2024-01-01')) / 86400000 + 1;
      await expect(page.locator('#views-value')).toHaveText(new Intl.NumberFormat('ru-RU').format(days * 8));
      const calls = trafficCalls.filter(query => query.from >= '2024-01-01' && query.to <= '2026-10-18').slice(-Math.ceil(days / 90));
      expect(calls[0].from).toBe('2024-01-01'); expect(calls.at(-1).to).toBe('2026-10-18');
      expect(calls.every(query => (Date.parse(query.to) - Date.parse(query.from)) / 86400000 < 90)).toBe(true);
      if (kind === 'visits') {
        await expect(page.locator('#daily-body tr')).toHaveCount(days);
        for (const selector of ['#platform-bars', '#source-bars']) {
          const weights = await page.locator(selector + ' .bar-heading').first().evaluate(row => [...row.children].map(child => getComputedStyle(child).fontWeight));
          expect(weights).toEqual(['400', '400']);
        }
      } else {
        await expect(page.locator('#total-czk')).toHaveText('990 Kč');
        await expect(page.locator('.chart-income')).toHaveCount(days);
      }
    }
    for (const width of [1440, 780, 390, 320]) {
      await page.setViewportSize({width, height: 1000});
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator('.presets button').evaluateAll(buttons => buttons.every(button => {
        const box = button.getBoundingClientRect(); return box.width > 0 && button.scrollWidth <= button.clientWidth;
      }))).toBe(true);
    }
    if (kind === 'earnings') await page.screenshot({path: 'test-results/report-periods-earnings-mobile.png', fullPage: true});
    expect(errors).toEqual([]);
  });
}
