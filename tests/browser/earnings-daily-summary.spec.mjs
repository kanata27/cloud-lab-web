import {test, expect} from '../support/browser.mjs';
import {earning} from '../support/insights-fixtures.mjs';
import {convert} from '../../statistics-panel/earnings-model.js';

async function expectSummaryGrid(page, width) {
  await page.setViewportSize({width, height: 1000});
  const layout = await page.evaluate(() => {
    const box = element => {
      const rect = element.getBoundingClientRect();
      return {left: rect.left, right: rect.right, top: rect.top, width: rect.width};
    };
    const table = document.querySelector('.summary-table'), panel = document.querySelector('.earnings-metrics').getBoundingClientRect();
    return {
      pageFits: document.documentElement.scrollWidth <= innerWidth,
      panels: ['#filters', '.earnings-metrics', '.daily-panel'].map(selector => box(document.querySelector(selector))),
      rows: [...table.rows].map(row => [...row.cells].map(box)),
      valueStarts: [...table.tBodies[0].rows].map(row => [...row.querySelectorAll('.summary-value')].map(box)),
      overflow: [...table.querySelectorAll('.summary-value,.summary-equivalent,.summary-note')].flatMap(element => {
        const rect = element.getBoundingClientRect(), parent = element.closest('td').getBoundingClientRect();
        return rect.left >= parent.left && rect.right <= parent.right && rect.left >= panel.left && rect.right <= panel.right
          && element.scrollWidth <= element.clientWidth + 1
          ? [] : [{text: element.textContent, scroll: element.scrollWidth, available: element.clientWidth}];
      }),
    };
  });
  expect(layout.pageFits, `page at ${width}px`).toBe(true);
  expect(layout.overflow, `summary content at ${width}px`).toEqual([]);
  for (const panel of layout.panels.slice(1)) {
    expect(panel.left).toBeCloseTo(layout.panels[0].left, 1);
    expect(panel.right).toBeCloseTo(layout.panels[0].right, 1);
  }
  if (width > 760) {
    for (const row of layout.rows.slice(1)) {
      for (let column = 0; column < 4; column++) {
        expect(row[column].left).toBeCloseTo(layout.rows[0][column].left, 1);
        expect(row[column].width).toBeCloseTo(layout.rows[0][column].width, 1);
      }
    }
    for (const row of layout.valueStarts) {
      for (const value of row.slice(1)) expect(value.top).toBeCloseTo(row[0].top, 1);
    }
  }
}

test('performance duration follows entries, period and spot; the summary table aligns with filters and chart', async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-10-19T12:00:00Z'));
  const entries = [
    earning('2026-10-01', 'morning', '113.6', '10:00', '12:00'),
    {...earning('2026-10-01', 'evening', '200.4', '15:00', '18:00'), spotId: 'spot-b'},
    earning('2026-10-19', 'today', '50.5', '14:00', '15:21'),
  ];
  entries[0].amounts.find(amount => amount.currency === 'EUR').minor = 100;
  entries[1].amounts.find(amount => amount.currency === 'USD').minor = 100;
  for (const entry of entries) Object.assign(entry, convert(entry.amounts, entry.snapshot));
  await page.route('**/earnings-api/**', async route => {
    const url = new URL(route.request().url()), query = url.searchParams;
    if (url.pathname.endsWith('/spots')) return route.fulfill({json: {spots: [
      {id: 'spot-a', name: 'Набережная'}, {id: 'spot-b', name: 'Площадь'},
    ]}});
    if (url.pathname.endsWith('/rates')) return route.fulfill({json: {
      requestedDate: query.get('date'), rates: {CZK: 1, EUR: 25, USD: 20},
      dates: {CZK: query.get('date'), EUR: query.get('date'), USD: query.get('date')},
    }});
    return route.fulfill({json: {entries: entries.filter(entry => entry.date >= query.get('from')
      && entry.date <= query.get('to') && (!query.get('spot') || entry.spotId === query.get('spot'))) }});
  });
  await page.goto('/stat-panel/earnings');
  await expect(page.locator('#count')).toHaveText('3');
  await expect(page.locator('#average-duration')).toHaveText('2 ч 7 мин');
  await expect(page.locator('#weekly-count')).toHaveText('0,5');
  await expect(page.locator('#total-time')).toHaveText('6 ч 21 мин');
  await expect(page.locator('#total-czk')).toHaveText('409,5 Kč');
  await expect(page.locator('#daily-chart .chart-value')).toHaveText(['359', '51']);
  await expect(page.locator('.summary-table thead th')).toHaveText(['Показатель', 'Заработок', 'Время', 'Выступления']);
  await expect(page.locator('.summary-table tbody th')).toHaveText(['Всего', 'В среднем']);
  await expect(page.locator('.summary-table tbody td')).toHaveCount(6);
  await expect(page.locator('#average-duration').locator('..')).toContainText('на выступление');
  await expect(page.locator('#weekly-count').locator('..')).toContainText('в неделю');
  await expect(page.locator('#hour-czk')).toHaveText('64,5 Kč/ч');
  await expect(page.locator('#hour-eur')).toHaveText('(2,6 €/ч)');
  await expectSummaryGrid(page, 1440);
  await page.locator('.earnings-metrics').screenshot({path: 'test-results/earnings-daily-summary-desktop.png'});
  await page.screenshot({path: 'test-results/earnings-summary-context.png'});
  for (const width of [1920, 1536, 1280, 1200, 1199, 1100, 1024, 900, 780, 761, 760, 600, 390, 375, 320]) await expectSummaryGrid(page, width);
  await page.locator('.earnings-metrics').screenshot({path: 'test-results/earnings-daily-summary-mobile.png'});
  await page.setViewportSize({width: 1440, height: 1000});
  await page.locator('#filter-spot').selectOption('spot-a'); await page.locator('#show').click();
  await expect(page.locator('#average-duration')).toHaveText('1 ч 41 мин');
  await expect(page.locator('#daily-chart .chart-value')).toHaveText(['139', '51']);
  await expect(page.locator('#entries-body tr').first().locator('td').nth(5)).toContainText('138,6 Kč');
  await expect(page.locator('#entries-body tr').first().locator('td').nth(6)).toContainText('69,3 Kč');
  await page.getByRole('button', {name: 'За час', exact: true}).click();
  await expect(page.locator('#daily-chart .chart-value')).toHaveText(['69', '37']);
  expect(await page.locator('#daily-chart .chart-tick').allTextContents()).toEqual(
    expect.arrayContaining(['0']));
  expect((await page.locator('#daily-chart .chart-tick').allTextContents()).every(text => !text.includes(','))).toBe(true);
  await page.locator('#from').fill('2026-10-01'); await page.locator('#to').fill('2026-10-01'); await page.locator('#show').click();
  await expect(page.locator('#average-duration')).toHaveText('2 ч');
  await expect(page.locator('#weekly-count')).toHaveText('—');
  await page.locator('#filter-spot').selectOption(''); await page.locator('#show').click();
  await expect(page.locator('#average-duration')).toHaveText('2 ч 30 мин');
  await page.locator('#from').fill('2026-10-02'); await page.locator('#to').fill('2026-10-03'); await page.locator('#show').click();
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('#average-duration')).toHaveText('—');
  await expect(page.locator('#count')).toHaveText('0');
});

test('summary keeps long totals, units and all six readings visible on narrow screens and in dark mode', async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-10-20T07:00:00Z'));
  const entries = ['2026-10-03','2026-10-04','2026-10-09','2026-10-14','2026-10-18','2026-10-19']
    .map(date => earning(date, date, '999999.99', '00:00', '23:59'));
  await page.route('**/earnings-api/**', route => route.fulfill({json:
    route.request().url().includes('/spots') ? {spots: [{id: 'spot-a', name: 'Набережная'}]} : {entries},
  }));
  await page.goto('/stat-panel/earnings');
  await expect(page.locator('#count')).toHaveText('6');
  await expect(page.locator('#total-czk')).toHaveText('5 999 999,94 Kč');
  await expect(page.locator('#total-time')).toHaveText('143 ч 54 мин');
  await expect(page.locator('.summary-table .summary-value')).toHaveCount(6);
  for (const width of [1440, 1024, 780, 761, 760, 600, 390, 320]) await expectSummaryGrid(page, width);
  await page.emulateMedia({colorScheme: 'dark'});
  await expectSummaryGrid(page, 1440);
  await page.locator('.earnings-metrics').screenshot({path: 'test-results/earnings-summary-dark.png'});
  await expectSummaryGrid(page, 320);
  await page.locator('.earnings-metrics').screenshot({path: 'test-results/earnings-summary-long-mobile.png'});
});

test('weekly frequency excludes partial weeks, counts empty weeks and follows the applied range while editing notes', async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-10-20T07:00:00Z'));
  let entries = [
    ['2026-10-04', 100], ['2026-10-06', 320], ['2026-10-08', 480],
    ['2026-10-13', 390], ['2026-10-15', 460], ['2026-10-18', 360], ['2026-10-19', 100],
  ].map(([date, amount], index) => ({...earning(date, `weekly-${index}`, String(amount), '14:00', '17:21'),
    spotId: index === 2 || index === 4 ? 'spot-b' : 'spot-a'}));
  await page.route('**/earnings-api/**', async route => {
    const request = route.request(), url = new URL(request.url()), query = url.searchParams;
    if (url.pathname.endsWith('/spots')) return route.fulfill({json: {spots: [
      {id: 'spot-a', name: 'Набережная'}, {id: 'spot-b', name: 'Площадь'},
    ]}});
    if (request.method() === 'PUT' && url.pathname.endsWith('/note')) {
      const id = url.pathname.split('/').at(-2), input = request.postDataJSON();
      const saved = {...entries.find(entry => entry.id === id), note: input.note, version: input.version + 1};
      entries = entries.map(entry => entry.id === id ? saved : entry);
      return route.fulfill({json: saved});
    }
    return route.fulfill({json: {entries: entries.filter(entry => entry.date >= query.get('from')
      && entry.date <= query.get('to') && (!query.get('spot') || entry.spotId === query.get('spot'))) }});
  });
  const range = async (from, to) => {
    await page.locator('#from').fill(from); await page.locator('#to').fill(to); await page.locator('#show').click();
    await expect(page.locator('#report')).toBeVisible();
  };
  await page.goto('/stat-panel/earnings');
  await range('2026-10-05', '2026-10-18');
  await expect(page.locator('#weekly-count')).toHaveText('2,5');
  await expect(page.locator('#weekly-count')).toHaveAttribute('title', /Полных недель пн–вс: 2/);
  await expect(page.locator('#total-czk')).toHaveText('2 010 Kč');
  await expect(page.locator('#total-time')).toHaveText('16 ч 45 мин');
  await expect(page.locator('#average-duration')).toHaveText('3 ч 21 мин');
  await page.locator('#from').fill('2026-10-06');
  await page.locator('.entry-note-trigger').first().click();
  await page.locator('#note-text').fill('Тестовая заметка'); await page.locator('#save-note').click();
  await expect(page.locator('#note-dialog')).not.toBeVisible();
  await expect(page.locator('#weekly-count')).toHaveText('2,5');
  await page.locator('#show').click();
  await expect(page.locator('#weekly-count')).toHaveText('3');
  await expect(page.locator('#count')).toHaveText('5');
  await range('2026-10-05', '2026-10-18');
  await page.locator('#filter-spot').selectOption('spot-a'); await page.locator('#show').click();
  await expect(page.locator('#weekly-count')).toHaveText('1,5');
  await page.locator('#filter-spot').selectOption('');
  await range('2026-09-21', '2026-10-18');
  await expect(page.locator('#weekly-count')).toHaveText('1,5');
  await range('2026-10-06', '2026-10-11');
  await expect(page.locator('#weekly-count')).toHaveText('—');
  await expect(page.locator('#count')).toHaveText('2');
  await range('2026-09-21', '2026-09-27');
  await expect(page.locator('#weekly-count')).toHaveText('0');
  await expect(page.locator('#average-duration')).toHaveText('—');
  await expect(page.locator('#empty')).toBeVisible();
});
