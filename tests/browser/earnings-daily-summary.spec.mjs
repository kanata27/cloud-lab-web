import {test, expect} from '../support/browser.mjs';
import {earning} from '../support/insights-fixtures.mjs';
import {convert} from '../../statistics-panel/earnings-model.js';

test('performance duration follows entries, period and spot; the two centered strips preserve chart precision', async ({page}) => {
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
  await expect(page.locator('#average-duration').locator('..')).toHaveText('Длительность выступления2 ч 7 мин');
  await expect(page.locator('.metric-count h2')).toHaveText('Всего');
  const layout = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.summary-strip')].map(element => {
      const box = element.getBoundingClientRect(); return {left: box.left, width: box.width};
    });
    const filter = document.querySelector('#filters').getBoundingClientRect();
    const count = document.querySelector('#count').getBoundingClientRect(), group = document.querySelector('.metric-count').getBoundingClientRect();
    return {boxes, filter: {left: filter.left, width: filter.width}, countCenter: count.left + count.width / 2, groupCenter: group.left + group.width / 2};
  });
  expect(layout.boxes).toHaveLength(2);
  expect(layout.boxes[0]).toEqual(layout.boxes[1]);
  expect(layout.boxes[0].width).toBeLessThan(layout.filter.width * .9);
  expect(layout.boxes[0].left + layout.boxes[0].width / 2).toBeCloseTo(layout.filter.left + layout.filter.width / 2, 1);
  expect(Math.abs(layout.countCenter - layout.groupCenter)).toBeLessThanOrEqual(1);
  await page.locator('.earnings-metrics').screenshot({path: 'test-results/earnings-daily-summary-desktop.png'});
  for (const width of [1280, 1200, 1199, 1024, 780, 760, 600, 390, 320]) {
    await page.setViewportSize({width, height: 1000});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const overflow = await page.locator('.earnings-metrics .metric').evaluateAll(cards => cards.flatMap(card => {
      const parent = card.getBoundingClientRect();
      return [...card.children].flatMap(child => {
        const rect = child.getBoundingClientRect();
        return rect.left >= parent.left && rect.right <= parent.right && child.scrollWidth <= child.clientWidth + 1
          ? [] : [{text: child.textContent, scroll: child.scrollWidth, available: child.clientWidth}];
      });
    }));
    expect(overflow, `metric content at ${width}px`).toEqual([]);
  }
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
