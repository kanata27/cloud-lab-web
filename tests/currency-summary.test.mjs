import test from 'node:test';
import assert from 'node:assert/strict';
import {sumForeignAmounts, valueForeignAmounts} from '../statistics-panel/currency-summary-model.js';

const entry = (czk, eur, usd = 0, extra = []) => ({amounts: [
  {currency: 'CZK', minor: czk * 100}, {currency: 'EUR', minor: eur * 100},
  {currency: 'USD', minor: usd * 100}, ...extra,
], czkMinor: 999999, snapshot: {rates: {EUR: 10}}});
const asOf = '2026-10-19';
const snapshot = {requestedDate: asOf, rates: {CZK: 1, EUR: 24.342, USD: 21.72, JPY: .14, GBP: 28.5, PLN: 5.7, CHF: 26, HUF: .062},
  dates: Object.fromEntries(['CZK', 'EUR', 'USD', 'JPY', 'GBP', 'PLN', 'CHF', 'HUF'].map(currency => [currency, '2026-10-16']))};

test('foreign totals sum original currencies exactly, ignore CZK and zeros, and do not touch historical totals', () => {
  const entries = [entry(100, 3), entry(50, 2.5), entry(999, 0)], before = structuredClone(entries);
  const totals = sumForeignAmounts(entries);
  assert.deepEqual(totals, [{currency: 'EUR', minor: 550}]);
  assert.deepEqual(valueForeignAmounts(totals, snapshot, asOf), {
    values: [{currency: 'EUR', minor: 550, czkMinor: 13388, date: '2026-10-16'}], dates: ['2026-10-16'],
  });
  assert.deepEqual(entries, before);
  assert.deepEqual(sumForeignAmounts([entry(100, 0)]), []);
  assert.deepEqual(sumForeignAmounts([]), []);
  assert.deepEqual(sumForeignAmounts([entry(0, .01), entry(0, .02)]), [{currency: 'EUR', minor: 3}]);
});

test('all seven currencies, including 2000 yen, are valued with the current snapshot rather than saved entry rates', () => {
  const totals = sumForeignAmounts([entry(100, 5.5, 6, [
    {currency: 'JPY', minor: 200000}, {currency: 'GBP', minor: 1000}, {currency: 'PLN', minor: 2500},
    {currency: 'CHF', minor: 500}, {currency: 'HUF', minor: 100000},
  ])]);
  assert.deepEqual(totals.map(row => row.currency), ['EUR', 'USD', 'JPY', 'GBP', 'PLN', 'CHF', 'HUF']);
  assert.deepEqual(valueForeignAmounts(totals, snapshot, asOf).values.map(row => row.czkMinor), [13388, 13032, 28000, 28500, 14250, 13000, 6200]);
});

test('unsupported current currencies keep their received amount and are never shown as zero CZK', () => {
  const totals = [{currency: 'EUR', minor: 550}, {currency: 'XXX', minor: 200000}];
  const values = valueForeignAmounts(totals, snapshot, asOf).values;
  assert.equal(values[0].czkMinor, 13388);
  assert.deepEqual(values[1], {currency: 'XXX', minor: 200000, czkMinor: null, date: null});
  for (const patch of [{rates: {...snapshot.rates, EUR: NaN}}, {rates: {...snapshot.rates, EUR: -1}},
    {dates: {...snapshot.dates, EUR: '2026-10-20'}}, {rates: {...snapshot.rates, EUR: Number.MAX_VALUE}}]) {
    assert.equal(valueForeignAmounts(totals, {...snapshot, ...patch}, asOf).values[0].czkMinor, null);
  }
});

test('malformed amounts, duplicate currencies, unsafe totals and a wrong current-rate date cannot silently change money', () => {
  for (const rows of [null, [{}], [{amounts: [{currency: 'eur', minor: 10}]}],
    [{amounts: [{currency: 'EUR', minor: -1}]}], [{amounts: [{currency: 'EUR', minor: 1.5}]}],
    [{amounts: [{currency: 'EUR', minor: 1}, {currency: 'EUR', minor: 2}]}],
    [{amounts: [{currency: 'EUR', minor: Number.MAX_SAFE_INTEGER}]}, {amounts: [{currency: 'EUR', minor: 1}]}]]) {
    assert.throws(() => sumForeignAmounts(rows));
  }
  for (const bad of [null, {...snapshot, requestedDate: '2026-10-18'}, {...snapshot, rates: {CZK: 2}},
    {...snapshot, dates: {...snapshot.dates, CZK: '2026-10-20'}}]) {
    assert.throws(() => valueForeignAmounts([{currency: 'EUR', minor: 550}], bad, asOf));
  }
});
