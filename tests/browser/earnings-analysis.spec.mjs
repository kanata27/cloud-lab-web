import {test, expect} from '../support/browser.mjs';
import {earning, trafficReport} from '../support/insights-fixtures.mjs';
import {validateEntry, convert} from '../../statistics-panel/earnings-model.js';

async function mockEarnings(page, {foreign = false, secondSpot = false} = {}) {
  const first = earning('2026-10-09', 'first', '100');
  if (foreign) {
    first.amounts[1].minor = 100;
    Object.assign(first, convert(first.amounts, first.snapshot));
  }
  const state = {entries: [first], spots: [{id: 'spot-a', name: 'Набережная'}], years: [], analysisCalls: 0};
  if (secondSpot) {
    state.spots.push({id: 'spot-b', name: 'Площадь'});
    state.entries.push({...earning('2026-10-08', 'second', '600'), spotId: 'spot-b'});
  }
  await page.route('**/api/stats?**', route => {
    const query = new URL(route.request().url()).searchParams;
    return route.fulfill({json: trafficReport(query.get('from'), query.get('to'))});
  });
  await page.route('**/earnings-api/**', route => {
    const request = route.request(), url = new URL(request.url()), query = url.searchParams;
    if (url.pathname.endsWith('/calendar')) {
      state.analysisCalls++;
      const year = Number(query.get('year')); state.years.push(year);
      const grouped = new Map();
      for (const entry of state.entries.filter(entry => entry.date.startsWith(String(year)))) {
        const day = grouped.get(entry.date) || {date: entry.date, czkMinor: 0, eurMinor: 0, minutes: 0, count: 0, spots: []};
        day.czkMinor += entry.czkMinor; day.eurMinor += entry.eurMinor; day.minutes += entry.minutes; day.count++;
        const name = state.spots.find(spot => spot.id === entry.spotId).name;
        if (!day.spots.includes(name)) day.spots.push(name);
        grouped.set(entry.date, day);
      }
      return route.fulfill({json: {year, days: [...grouped.values()].sort((a,b) => a.date.localeCompare(b.date))}});
    }
    if (url.pathname.includes('/spots')) {
      state.analysisCalls++;
      if (request.method() === 'PUT') {
        const spot = state.spots.find(spot => spot.id === url.pathname.split('/').at(-1));
        spot.name = request.postDataJSON().name;
        return route.fulfill({json: spot});
      }
      return route.fulfill({json: {spots: state.spots}});
    }
    if (url.pathname.endsWith('/rates')) {
      const date = query.get('date');
      return route.fulfill({json: {requestedDate: date, rates: {CZK: 1, EUR: 25, USD: 20}, dates: {CZK: date, EUR: date, USD: date}}});
    }
    if (request.method() === 'GET') return route.fulfill({json: {entries: state.entries.filter(entry => entry.date >= query.get('from')
      && entry.date <= query.get('to') && (!query.get('spot') || entry.spotId === query.get('spot')))}});
    const id = url.pathname.split('/').at(-1);
    if (request.method() === 'DELETE') {
      state.entries = state.entries.filter(entry => entry.id !== id);
      return route.fulfill({json: {deleted: true}});
    }
    const input = request.postDataJSON(), data = validateEntry(input), snapshot = {requestedDate: data.date, rates: {CZK: 1, EUR: 25, USD: 20}};
    const entry = {...data, ...convert(data.amounts, snapshot), snapshot, id: request.method() === 'PUT' ? id : input.id, version: (input.version || 0) + 1};
    state.entries = [...state.entries.filter(previous => previous.id !== entry.id), entry];
    return route.fulfill({json: entry});
  });
  return state;
}

test.beforeEach(async ({page}) => page.clock.setFixedTime(new Date('2026-10-20T20:00:00Z')));

test('both earnings analyses sit between currencies and performances; Insights no longer loads their data', async ({page}) => {
  const state = await mockEarnings(page, {foreign: true});
  await page.goto('/stat-panel/earnings');
  await expect(page.locator('#annual-report')).toBeVisible();
  await expect(page.locator('#foreign-currencies')).toBeVisible();
  for (const width of [1440, 1000, 780, 390, 320]) {
    await page.setViewportSize({width, height: 1000});
    const boxes = await page.locator('#foreign-currencies,.weekday-panel,#annual-panel,.performances').evaluateAll(panels => panels.map(panel => {
      const box = panel.getBoundingClientRect(); return {left: box.left, right: box.right, top: box.top, bottom: box.bottom};
    }));
    expect(boxes).toHaveLength(4);
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i].left).toBeCloseTo(boxes[0].left, 1);
      expect(boxes[i].right).toBeCloseTo(boxes[0].right, 1);
      expect(boxes[i].top - boxes[i - 1].bottom).toBeGreaterThanOrEqual(19);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 320) {
      await page.locator('.weekday-panel').screenshot({path: 'test-results/moved-weekdays-mobile.png'});
      await page.locator('#annual-panel').screenshot({path: 'test-results/moved-calendar-mobile.png'});
    }
  }
  await page.setViewportSize({width: 1440, height: 1000});
  await page.locator('.weekday-panel').screenshot({path: 'test-results/moved-weekdays-desktop.png'});
  await page.locator('#annual-panel').screenshot({path: 'test-results/moved-calendar-desktop.png'});
  const calls = state.analysisCalls;
  await page.goto('/stat-panel/insights');
  await expect(page.locator('#report')).toBeVisible();
  await expect(page.locator('.weekday-panel,#annual-panel')).toHaveCount(0);
  await expect(page.locator('#insights-chart svg')).toHaveCount(1);
  expect(state.analysisCalls).toBe(calls);
});

test('weekday spot follows the applied main filter and restores its independent selection for all spots', async ({page}) => {
  await mockEarnings(page, {secondSpot: true});
  await page.goto('/stat-panel/earnings');
  await expect(page.locator('#weekday-spot')).toBeVisible();
  await page.locator('#weekday-spot').selectOption('spot-b');
  await expect(page.locator('.weekday-rate').first()).toHaveText('300 Kč/ч');
  await page.locator('#filter-spot').selectOption('spot-a');
  await expect(page.locator('#weekday-spot')).toBeVisible();
  await page.locator('#show').click();
  await expect(page.locator('#weekday-spot')).toBeHidden();
  await expect(page.locator('#weekday-only-spot')).toHaveText('Набережная');
  await expect(page.locator('.weekday-rate').first()).toHaveText('50 Kč/ч');
  await expect(page.locator('#count')).toHaveText('1');
  await page.locator('#filter-spot').selectOption(''); await page.locator('#show').click();
  await expect(page.locator('#weekday-spot')).toHaveValue('spot-b');
  await expect(page.locator('.weekday-rate').first()).toHaveText('300 Kč/ч');
});

test('entry creation, editing, deletion and spot renaming refresh the annual calendar', async ({page}) => {
  const state = await mockEarnings(page);
  await page.goto('/stat-panel/earnings');
  await expect(page.locator('#annual-summary')).toHaveText('Дней с выступлениями: 1');
  await page.locator('#add-entry').click();
  await page.locator('#entry-start').fill('14:00'); await page.locator('#entry-end').fill('16:00');
  await page.getByRole('textbox', {name: 'Сумма CZK', exact: true}).fill('220');
  await page.locator('#save-entry').click();
  await expect(page.locator('#entry-dialog')).toBeHidden();
  await expect(page.locator('#annual-summary')).toHaveText('Дней с выступлениями: 2');
  await expect(page.locator('#annual-days [data-date="2026-10-20"]')).toHaveAttribute('data-hour', '110');
  const created = state.entries.find(entry => entry.date === '2026-10-20');
  const row = () => page.locator(`[data-entry-id="${created.id}"]`);
  await row().locator('.entry-trigger').click(); await page.getByRole('button', {name: 'Изменить данные'}).click();
  await page.locator('#entry-date').fill('2026-10-19');
  await page.getByRole('textbox', {name: 'Сумма CZK', exact: true}).fill('400');
  await page.locator('#save-entry').click();
  await expect(page.locator('#annual-days [data-date="2026-10-19"]')).toHaveAttribute('data-hour', '200');
  await expect(page.locator('#annual-days [data-date="2026-10-20"]')).toHaveAttribute('data-level', '0');
  await page.locator('#add-entry').click(); await page.locator('#open-spots').click();
  await page.locator('.spot-edit').click(); await page.locator('#spot-name').fill('Новое место'); await page.locator('#save-spot').click();
  await expect(page.locator('#spot-dialog')).toBeHidden(); await page.locator('#cancel-entry').click();
  await page.locator('#annual-days [data-date="2026-10-19"]').hover();
  await expect(page.locator('#annual-tooltip')).toContainText('Новое место');
  await row().locator('.entry-trigger').click(); await page.getByRole('button', {name: 'Удалить запись', exact: true}).click();
  await page.locator('#confirm-delete').click();
  await expect(page.locator('#annual-summary')).toHaveText('Дней с выступлениями: 1');
  await expect(page.locator('#annual-days [data-date="2026-10-19"]')).toHaveAttribute('data-level', '0');
  await page.locator('#annual-year').selectOption('2024');
  await expect(page.locator('#annual-days .annual-day')).toHaveCount(366);
  await page.locator('[data-days="7"]').click();
  await expect(page.locator('#report')).toBeVisible();
  await expect(page.locator('#annual-year')).toHaveValue('2024');
});
