import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {database} from './support/database.mjs';
import {accessEnv, accessToken, keysResponse} from './support/access-fixture.mjs';
import {earning} from './support/insights-fixtures.mjs';
import {loadEarningsEntries} from '../statistics-panel/report-loader.js';

test('private earnings API returns more than 2000 entries across years, including tied timestamps and spot filters', async () => {
  const {sqlite, db} = database(), timestamp = '2024-01-01T12:00:00Z';
  for (const id of ['a', 'b']) sqlite.prepare('INSERT INTO earnings_spots VALUES(?,?,?,?)').run('spot-' + id, 'Точка ' + id, 'точка ' + id, timestamp);
  const insert = sqlite.prepare('INSERT INTO earnings_entries VALUES(?,?,?,?,?,?,?)'), expected = [];
  for (let index = 0; index < 2503; index++) {
    const id = 'entry-' + String(index).padStart(4, '0');
    const entry = {...earning(index % 2 ? '2024-02-29' : '2026-10-09', id), spotId: index % 3 ? 'spot-a' : 'spot-b'};
    insert.run(id, entry.date, entry.spotId, 1, JSON.stringify(entry), timestamp, timestamp);
    expected.push(entry);
  }
  expected.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const token = await accessToken(), originalFetch = globalThis.fetch;
  globalThis.fetch = keysResponse;
  const call = (query, authorized = true) => worker.fetch(new Request('https://kanata.test/earnings-api/entries?' + new URLSearchParams(query),
    {headers: authorized ? {'Cf-Access-Jwt-Assertion': token} : {}}), {...accessEnv, EARNINGS_DB: db});
  const range = {from: '2024-01-01', to: '2026-10-18', spot: ''};
  try {
    assert.equal((await call(range, false)).status, 401);
    const pages = [];
    const read = async query => {
      const response = await call(query); assert.equal(response.status, 200);
      assert.match(response.headers.get('Cache-Control'), /no-store.*private/);
      const data = await response.json(); pages.push(data); return data;
    };
    const all = await loadEarningsEntries(range, read);
    assert.deepEqual(pages.map(page => page.entries.length), [1000, 1000, 503]);
    assert.deepEqual(all.entries.map(entry => entry.id), expected.map(entry => entry.id));
    const filtered = await loadEarningsEntries({...range, spot: 'spot-a'}, read);
    assert.deepEqual(filtered.entries.map(entry => entry.id), expected.filter(entry => entry.spotId === 'spot-a').map(entry => entry.id));
    const cursor = pages[0].nextCursor;
    for (const query of [{...range, cursor: '!invalid'}, {...range, cursor, from: '2025-01-01'},
      {...range, cursor, spot: 'spot-b'}, {...range, cursor: 'x'.repeat(2049)}, {...range, from: '2024-02-30'},
      {...range, to: '2023-12-31'}, {...range, spot: "a' OR 1=1"}]) {
      assert.equal((await call(query)).status, 400);
    }
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM earnings_entries').get().n, 2503);
  } finally {
    globalThis.fetch = originalFetch; sqlite.close();
  }
});
