import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {validateNote, NOTE_MAX_LENGTH} from '../statistics-panel/earnings-model.js';
import {database} from './support/database.mjs';
import {accessEnv, accessToken, keysResponse} from './support/access-fixture.mjs';
import {earning} from './support/insights-fixtures.mjs';

test('notes accept plain multiline text and reject invalid or excessive input', () => {
  assert.equal(validateNote('  Ветер\r\nВторая строка\rТретья  '), 'Ветер\nВторая строка\nТретья');
  assert.equal(validateNote(''), '');
  assert.equal(validateNote('x'.repeat(NOTE_MAX_LENGTH)).length, NOTE_MAX_LENGTH);
  for (const value of [null, undefined, 1, {}, 'x'.repeat(NOTE_MAX_LENGTH + 1), 'hidden\u0000text']) {
    assert.throws(() => validateNote(value));
  }
});

test('notes persist privately, keep all money and rates, and never overwrite a concurrent edit', async () => {
  const {sqlite, db} = database();
  const entry = earning('2026-10-09', 'note-entry');
  const {id, version, ...payload} = entry;
  delete payload.note; // An existing row from before notes were available.
  const timestamp = '2026-10-09T18:00:00Z';
  sqlite.prepare('INSERT INTO earnings_spots VALUES(?,?,?,?)').run('spot-a', 'Точка A', 'точка a', timestamp);
  sqlite.prepare('INSERT INTO earnings_entries VALUES(?,?,?,?,?,?,?)').run(id, entry.date, 'spot-a', version, JSON.stringify(payload), timestamp, timestamp);
  sqlite.prepare('INSERT INTO earnings_rates VALUES(?,?,?)').run(entry.date, JSON.stringify(entry.snapshot), timestamp);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.ok(String(url).includes('/cdn-cgi/access/certs'), 'Saving a note must not fetch currency rates');
    return keysResponse(url);
  };
  const call = async (path, method = 'GET', data, {authenticated = true, origin = 'https://kanata.test'} = {}) => {
    const response = await worker.fetch(new Request('https://kanata.test/earnings-api' + path, {
      method, headers: {'Content-Type': 'application/json', Origin: origin,
        ...(authenticated ? {'Cf-Access-Jwt-Assertion': await accessToken()} : {})},
      body: data === undefined ? undefined : JSON.stringify(data),
    }), {...accessEnv, EARNINGS_DB: db});
    return {status: response.status, data: await response.json()};
  };
  const list = '/entries?from=2026-10-01&to=2026-10-18';
  const path = `/entries/${id}/note`;
  try {
    assert.equal((await call(list)).data.entries[0].note, '');
    assert.equal((await call(path, 'PUT', {version: 1, note: 'No'}, {authenticated: false})).status, 401);
    assert.equal((await call(path, 'PUT', {version: 1, note: 'No'}, {origin: 'https://another.test'})).status, 403);
    assert.equal((await call(list, 'GET', undefined, {authenticated: false})).status, 401);
    for (const note of [null, {}, 'x'.repeat(NOTE_MAX_LENGTH + 1), 'bad\u0000note']) {
      assert.equal((await call(path, 'PUT', {version: 1, note})).status, 400);
    }
    const note = 'Сильный ветер\n<img src=x onerror=alert(1)> — обычный текст';
    const saved = await call(path, 'PUT', {version: 1, note});
    assert.equal(saved.status, 200);
    assert.equal(saved.data.version, 2);
    assert.equal(saved.data.note, note);
    assert.equal(saved.data.createdAt, timestamp);
    for (const [key, value] of Object.entries(payload)) assert.deepEqual(saved.data[key], value, key);
    assert.equal((await call(path, 'PUT', {version: 1, note: 'Stale'})).status, 409);
    assert.equal((await call('/entries/missing/note', 'PUT', {version: 1, note: 'Missing'})).status, 404);
    assert.deepEqual((await call(list)).data.entries, [saved.data]);
    // A still-open older client can edit the entry without silently deleting its note.
    const input = {...payload, version: 2, amounts: payload.amounts.map(row => ({currency: row.currency, amount: String(row.minor / 100)}))};
    const edited = await call(`/entries/${id}`, 'PUT', input);
    assert.equal(edited.status, 200);
    assert.equal(edited.data.note, note);
    assert.equal(edited.data.version, 3);
    assert.equal((await call(path, 'PUT', {version: 2, note: 'Stale again'})).status, 409);
    const cleared = await call(path, 'PUT', {version: 3, note: ''});
    assert.equal(cleared.status, 200);
    assert.equal(cleared.data.note, '');
    assert.equal(cleared.data.version, 4);
    const created = await call('/entries', 'POST', {...input, id: 'new-with-note', note: '  Новая заметка  '});
    assert.equal(created.status, 201);
    assert.equal(created.data.note, 'Новая заметка');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM earnings_entries').get().n, 2);
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});
