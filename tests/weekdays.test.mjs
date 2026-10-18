import test from 'node:test';
import assert from 'node:assert/strict';
import {WEEKDAYS, weekdayIndex, convert} from '../statistics-panel/earnings-model.js';
import {rankWeekdays} from '../statistics-panel/insights-model.js';
import {earning} from './support/insights-fixtures.mjs';

test('weekdays follow the saved calendar date, including leap days and year boundaries', () => {
  assert.equal(WEEKDAYS[weekdayIndex('2026-10-09')], 'Пятница');
  assert.equal(WEEKDAYS[weekdayIndex('2026-10-04')], 'Воскресенье');
  assert.equal(WEEKDAYS[weekdayIndex('2024-02-29')], 'Четверг');
  assert.equal(WEEKDAYS[weekdayIndex('2027-01-01')], 'Пятница');
  for (const date of ['2026-02-29', '2026-02-30', '09.10.2026', undefined]) assert.throws(() => weekdayIndex(date));
});

test('weekday ranking weights hours, reuses all converted currencies and isolates each spot', () => {
  const mixed = earning('2026-10-08', 'mixed', '0');
  mixed.snapshot.rates.PLN = 6;
  mixed.amounts = [{currency: 'CZK', minor: 10000}, {currency: 'EUR', minor: 200}, {currency: 'USD', minor: 100}, {currency: 'PLN', minor: 300}];
  Object.assign(mixed, convert(mixed.amounts, mixed.snapshot));
  const entries = [mixed, earning('2026-09-28', 'long-monday', '180', '12:00', '15:00'),
    earning('2026-10-05', 'short-monday', '120', '12:00', '13:00'), earning('2026-10-09', 'friday', '95'),
    {...earning('2026-10-06', 'other-spot', '900', '12:00', '13:00'), spotId: 'spot-b'}];
  const ranked = rankWeekdays(entries, 'spot-a');
  assert.deepEqual(ranked.map(day => [day.name, day.hourCzk]), [
    ['Четверг', 94], ['Понедельник', 75], ['Пятница', 47.5], ['Вторник', 0], ['Среда', 0], ['Суббота', 0], ['Воскресенье', 0],
  ]);
  assert.deepEqual(ranked.find(day => day.weekday === 0), {weekday: 0, name: 'Понедельник', czkMinor: 30000, minutes: 240, count: 2, hourCzk: 75});
  assert.equal(rankWeekdays(entries, 'spot-b')[0].hourCzk, 900);
  assert.equal(rankWeekdays(entries)[0].name, 'Вторник');
});

test('empty weekdays stay at zero in calendar order and zero earnings retain their playing time', () => {
  const empty = rankWeekdays([]);
  assert.deepEqual(empty.map(day => day.name), [...WEEKDAYS]);
  assert.ok(empty.every(day => day.hourCzk === 0 && day.minutes === 0 && day.count === 0));
  const zero = rankWeekdays([earning('2026-10-09', 'zero', '0')], 'spot-a');
  assert.equal(zero.find(day => day.name === 'Пятница').minutes, 120);
  assert.equal(zero.find(day => day.name === 'Пятница').count, 1);
  assert.ok(zero.every(day => day.hourCzk === 0));
  assert.deepEqual(rankWeekdays([earning('2026-10-09')], 'no-entries'), empty);
});

test('overnight performances and a Prague date ahead of UTC retain the entered weekday', () => {
  const entries = [
    {...earning('2026-10-03', 'overnight', '90'), start: '23:30', end: '01:00', nextDay: true, minutes: 90},
    {...earning('2026-10-05', 'after-midnight', '45'), startAt: '2026-10-04T22:15:00Z', minutes: 45},
  ];
  const rows = rankWeekdays(entries);
  assert.equal(rows.find(day => day.name === 'Суббота').hourCzk, 60);
  assert.equal(rows.find(day => day.name === 'Понедельник').hourCzk, 60);
  assert.equal(rows.find(day => day.name === 'Воскресенье').count, 0);
});

test('bad, duplicate and unsafe earnings cannot produce a plausible weekday ranking', () => {
  const entry = earning('2026-10-09', 'entry');
  for (const invalid of [{...entry, date: '2026-02-30'}, {...entry, minutes: 0}, {...entry, spotId: null},
    {...entry, czkMinor: -1}, {...entry, czkMinor: NaN}]) assert.throws(() => rankWeekdays([invalid]));
  assert.throws(() => rankWeekdays([entry, entry]));
  assert.throws(() => rankWeekdays(null));
  assert.throws(() => rankWeekdays([entry], null));
  assert.throws(() => rankWeekdays([{...entry, czkMinor: Number.MAX_SAFE_INTEGER}, {...entry, id: 'overflow', czkMinor: 1}]), /размер/);
});
