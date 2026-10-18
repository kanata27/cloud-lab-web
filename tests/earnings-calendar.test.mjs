import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {buildEarningsCalendar} from '../statistics-panel/earnings-calendar-model.js';
import {weekdayIndex} from '../statistics-panel/earnings-model.js';
import {database} from './support/database.mjs';
import {accessEnv, accessToken, keysResponse} from './support/access-fixture.mjs';
import {earning} from './support/insights-fixtures.mjs';

test('calendar covers exactly January through December, including leap years and 54-column years', () => {
  for (let year = 2000; year <= 2026; year++) {
    const model = buildEarningsCalendar({year, days: []}, year, '2026-10-18');
    const leap = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1;
    assert.equal(model.days.length, leap ? 366 : 365);
    assert.equal(model.days[0].date, `${year}-01-01`);
    assert.equal(model.days.at(-1).date, `${year}-12-31`);
    assert.equal(new Set(model.days.map(day => day.date)).size, model.days.length);
    assert.equal(model.months.length, 12);
    assert.equal(model.cells.length, model.weeks * 7);
    model.cells.forEach((day, index) => { if (day) assert.equal(index % 7, weekdayIndex(day.date)); });
    assert.equal(model.days.find(day => day.date === `${year}-02-29`) !== undefined, leap);
  }
  assert.equal(buildEarningsCalendar({year: 2012, days: []}, 2012).weeks, 54);
});

test('heat levels use hourly rates, distinguish played zero days and weight multiple performances by time', () => {
  const model = buildEarningsCalendar({year: 2024, days: [
    {date: '2024-01-01', czkMinor: 40000, eurMinor: 1600, minutes: 480, count: 2},
    {date: '2024-01-02', czkMinor: 10000, eurMinor: 400, minutes: 60, count: 1},
    {date: '2024-01-03', czkMinor: 0, eurMinor: 0, minutes: 60, count: 1},
  ]}, 2024);
  assert.deepEqual(model.days.slice(0, 4).map(day => [day.hourCzk, day.hourEur, day.level]), [
    [50, 2, 2], [100, 4, 4], [0, 0, 1], [null, null, 0],
  ]);
  assert.equal(model.activeDays, 3);
  assert.equal(model.count, 4);
  assert.equal(model.minutes, 600);
  const current = buildEarningsCalendar({year: 2026, days: []}, 2026, '2026-10-18');
  assert.equal(current.days.find(day => day.date === '2026-10-18').future, false);
  assert.equal(current.days.find(day => day.date === '2026-10-19').future, true);
});

test('incomplete, duplicate, out-of-year, future and unsafe calendar values are rejected', () => {
  const row = {date: '2024-02-29', czkMinor: 10000, eurMinor: 400, minutes: 60, count: 1};
  for (const data of [null, {year: 2024}, {year: 2023, days: []}, {year: 2024, days: [row, row]},
    ...[{date: '2024-02-30'}, {date: '2023-12-31'}, {count: 0}, {minutes: 0}, {minutes: 1441}, {czkMinor: -1}, {eurMinor: undefined}, {czkMinor: Number.MAX_SAFE_INTEGER + 1}]
      .map(patch => ({year: 2024, days: [{...row, ...patch}]}))]) {
    assert.throws(() => buildEarningsCalendar(data, 2024));
  }
  assert.throws(() => buildEarningsCalendar({year: 2026, days: [{...row, date: '2026-12-31'}]}, 2026, '2026-10-18'));
  assert.throws(() => buildEarningsCalendar({year: 1999, days: []}, 1999));
  assert.throws(() => buildEarningsCalendar({year: 2027, days: []}, 2027, '2026-10-18'));
});

test('private calendar aggregates the full year in D1, beyond 2000 records, without exposing notes or fetching FX', async () => {
  const {sqlite, db} = database(), timestamp = '2024-01-01T12:00:00Z';
  sqlite.prepare('INSERT INTO earnings_spots VALUES(?,?,?,?)').run('spot-a', 'Точка A', 'точка a', timestamp);
  sqlite.prepare('INSERT INTO earnings_spots VALUES(?,?,?,?)').run('spot-b', 'Точка B', 'точка b', timestamp);
  const insert = sqlite.prepare('INSERT INTO earnings_entries VALUES(?,?,?,?,?,?,?)');
  const save = entry => insert.run(entry.id, entry.date, entry.spotId, 1, JSON.stringify({...entry, note: 'Private test note'}), timestamp, timestamp);
  for (let index = 0; index < 2001; index++) save({...earning('2024-01-01', 'bulk-' + index, '1', '12:00', '13:00')});
  save(earning('2024-02-29', 'a', '100', '12:00', '13:00'));
  save({...earning('2024-02-29', 'b', '300', '13:00', '16:00'), spotId: 'spot-b'});
  save(earning('2024-12-31', 'last', '20', '12:00', '13:00'));
  save(earning('2023-12-31', 'excluded', '900'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.ok(String(url).includes('/cdn-cgi/access/certs'));
    return keysResponse(url);
  };
  const call = async (query, authorized = true) => worker.fetch(new Request('https://kanata.test/earnings-api/calendar' + query,
    {headers: authorized ? {'Cf-Access-Jwt-Assertion': await accessToken()} : {}}), {...accessEnv, EARNINGS_DB: db});
  try {
    assert.equal((await call('?year=2024', false)).status, 401);
    const response = await call('?year=2024');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Cache-Control'), /no-store.*private/);
    const data = await response.json();
    assert.deepEqual(data, {year: 2024, days: [
      {date: '2024-01-01', czkMinor: 200100, eurMinor: 8004, minutes: 120060, count: 2001},
      {date: '2024-02-29', czkMinor: 40000, eurMinor: 1600, minutes: 240, count: 2},
      {date: '2024-12-31', czkMinor: 2000, eurMinor: 80, minutes: 60, count: 1},
    ]});
    assert.equal(buildEarningsCalendar(data, 2024).days.find(day => day.date === '2024-02-29').hourCzk, 100);
    assert.deepEqual(await (await call('?year=2022')).json(), {year: 2022, days: []});
    for (const query of ['', '?year=', '?year=1999', '?year=2100', '?year=2024.0', '?year=2024%20OR%201=1']) {
      assert.equal((await call(query)).status, 400);
    }
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM earnings_entries').get().n, 2005);
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});
