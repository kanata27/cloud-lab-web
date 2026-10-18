import {test, expect} from '../support/browser.mjs';
import {earning} from '../support/insights-fixtures.mjs';
import {validateEntry, convert} from '../../statistics-panel/earnings-model.js';

async function notesAPI(page) {
  let entry = {...earning('2026-10-09', 'note-entry'), note: ''};
  let failure = null;
  const writes = [];
  await page.route('**/earnings-api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'GET') return route.fulfill({json: url.pathname.endsWith('/spots')
      ? {spots: [{id: 'spot-a', name: 'Точка A'}]} : {entries: [entry]}});
    const input = request.postDataJSON();
    writes.push({path: url.pathname, input});
    if (failure) return route.fulfill({status: failure, json: {error: failure === 409 ? 'Выступление изменено в другой вкладке. Обнови страницу.' : 'Не удалось сохранить заметку.'}});
    if (url.pathname.endsWith('/note')) entry = {...entry, note: input.note.trim(), version: entry.version + 1};
    else {
      const record = validateEntry(input);
      entry = {...entry, ...record, ...convert(record.amounts, entry.snapshot), version: entry.version + 1};
    }
    await route.fulfill({json: entry});
  });
  return {writes, get entry() { return entry; }, fail(status) { failure = status; }};
}

test.beforeEach(async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-10-18T12:00:00Z'));
  await page.addInitScript(() => {
    window.violations = [];
    document.addEventListener('securitypolicyviolation', event => window.violations.push(event.violatedDirective));
  });
});

test('a performance opens its persistent plain-text note; entry edits keep it and clearing removes its marker', async ({page}) => {
  const api = await notesAPI(page);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/stat-panel/earnings');
  await expect(page.locator('#entries-body tr')).toHaveCount(1);
  const totals = await page.locator('.metrics').innerText();
  await page.locator('#entries-body td').nth(3).click();
  await expect(page.locator('#note-dialog')).toBeVisible();
  await expect(page.locator('#note-context')).toContainText('09.10.2026 · Пятница');
  const text = 'Ветер и хороший звук\n<img src=x onerror="window.injected=true">';
  await page.locator('#note-text').fill(text);
  await expect(page.locator('#note-count')).toHaveText(`${text.length} / 2000`);
  await page.locator('#save-note').click();
  await expect(page.locator('#note-dialog')).toBeHidden();
  expect(api.entry.note).toBe(text);
  expect(await page.locator('.metrics').innerText()).toBe(totals);
  await expect(page.locator('.entry-note-trigger svg')).toHaveCount(1);
  expect(api.writes[0]).toEqual({path: '/earnings-api/entries/note-entry/note', input: {version: 1, note: text}});
  await page.reload();
  await page.locator('.entry-note-trigger').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#note-text')).toHaveValue(text);
  await expect(page.locator('#note-dialog img')).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await page.locator('#cancel-note').click();
  await expect(page.locator('.entry-note-trigger')).toBeFocused();
  await page.locator('.entry-trigger').click();
  await expect(page.locator('#note-dialog')).toBeHidden();
  await page.getByRole('button', {name: 'Изменить данные', exact: true}).click();
  await expect(page.locator('#entry-note')).toHaveValue(text);
  await page.locator('#entry-end').fill('17:00');
  await page.locator('#save-entry').click();
  await expect(page.locator('#entry-dialog')).toBeHidden();
  expect(api.entry.note).toBe(text);
  for (const width of [1440, 780, 390, 320]) {
    await page.setViewportSize({width, height: 900});
    await page.locator('.entry-note-trigger').click();
    await expect(page.locator('#note-text')).toHaveValue(text);
    expect(await page.locator('#note-dialog').evaluate(dialog => {
      const box = dialog.getBoundingClientRect();
      return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight && dialog.scrollWidth <= dialog.clientWidth;
    })).toBe(true);
    await page.keyboard.press('Escape');
  }
  await page.emulateMedia({colorScheme: 'dark'});
  await page.locator('.entry-note-trigger').click();
  await page.locator('#note-dialog').screenshot({path: 'test-results/performance-note-dark.png'});
  await page.locator('#note-text').fill('');
  await page.locator('#save-note').click();
  await expect(page.locator('#note-dialog')).toBeHidden();
  await expect(page.locator('.entry-note-trigger svg')).toHaveCount(0);
  await page.reload();
  await page.locator('.entry-note-trigger').click();
  await expect(page.locator('#note-text')).toHaveValue('');
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.violations)).toEqual([]);
});

test('a failed or conflicting note save keeps the draft, and cancel protects unsaved text', async ({page}) => {
  const api = await notesAPI(page);
  await page.goto('/stat-panel/earnings');
  await page.locator('.entry-note-trigger').click();
  await page.locator('#note-text').fill('Черновик');
  for (const failure of [503, 409]) {
    api.fail(failure);
    await page.locator('#save-note').click();
    await expect(page.locator('#note-error')).toBeVisible();
    await expect(page.locator('#note-text')).toHaveValue('Черновик');
    await expect(page.locator('#save-note')).toBeEnabled();
    expect(api.entry.note).toBe('');
  }
  page.once('dialog', dialog => dialog.dismiss());
  await page.keyboard.press('Escape');
  await expect(page.locator('#note-dialog')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#cancel-note').click();
  await expect(page.locator('#note-dialog')).toBeHidden();
  await page.locator('.entry-note-trigger').click();
  await expect(page.locator('#note-text')).toHaveValue('');
});
