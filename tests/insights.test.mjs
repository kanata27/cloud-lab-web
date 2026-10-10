import test from 'node:test';
import assert from 'node:assert/strict';
import {splitRanges, validateTrafficReport, buildInsights, byWeeks, axisScale} from '../statistics-panel/insights-model.js';
import {presetRange, validateDateRange, todayInZone} from '../statistics-panel/date-filter.js';
import {trafficReport, earning} from './support/insights-fixtures.mjs';

test('three calendar months include all 92 days, split without overlap at the API limit', () => {
  assert.deepEqual(splitRanges('2026-07-01', '2026-09-30'), [
    {from: '2026-07-01', to: '2026-09-28'}, {from: '2026-09-29', to: '2026-09-30'},
  ]);
  assert.deepEqual(presetRange('2026-09-30', {months: 3}), {from: '2026-07-01', to: '2026-09-30'});
  assert.deepEqual(presetRange('2024-05-31', {months: 3}), {from: '2024-03-01', to: '2024-05-31'});
  assert.equal(todayInZone('UTC', new Date('2026-10-09T22:30:00Z')), '2026-10-09');
  assert.equal(todayInZone('Europe/Prague', new Date('2026-10-09T22:30:00Z')), '2026-10-10');
  assert.throws(() => validateDateRange('2026-02-30', '2026-03-02', '2026-10-09'));
  assert.throws(() => validateDateRange('2026-10-08', '2026-10-10', '2026-10-09'));
});

test('joins both statistics by date, retains off-days, sums converted minor units and weights hours', () => {
  const result = buildInsights({from: '2026-07-01', to: '2026-07-07', traffic: [trafficReport('2026-07-01', '2026-07-07')],
    entries: [earning('2026-07-02', 'a', '1600', '12:00', '16:00'), earning('2026-07-06', 'b', '600', '12:00', '13:00')]});
  assert.equal(result.daily.length, 7);
  assert.equal(result.daily[0].czkMinor, 0);
  assert.equal(result.daily[0].views, 8);
  assert.equal(result.daily[1].czkMinor, 160000);
  assert.deepEqual(result.totals, {czkMinor: 220000, minutes: 300, views: 56, youtube: 7, instagram: 14, hourCzk: 440});
});

test('weekly totals start on Monday, clip both edges and preserve all period totals', () => {
  const ranges = splitRanges('2026-07-01', '2026-09-30');
  const report = buildInsights({from: '2026-07-01', to: '2026-09-30', traffic: ranges.map(range => trafficReport(range.from, range.to, 16)),
    entries: [earning('2026-07-02', 'a'), earning('2026-09-30', 'b', '500')]});
  const weeks = byWeeks(report.daily);
  assert.equal(weeks.length, 14);
  assert.deepEqual([weeks[0].from, weeks[0].to, weeks[0].views, weeks[0].czkMinor], ['2026-07-01', '2026-07-05', 80, 22000]);
  assert.deepEqual([weeks[1].from, weeks[1].to, weeks[1].views], ['2026-07-06', '2026-07-12', 112]);
  assert.deepEqual([weeks.at(-1).from, weeks.at(-1).to, weeks.at(-1).views, weeks.at(-1).czkMinor], ['2026-09-28', '2026-09-30', 48, 50000]);
  for (const key of ['czkMinor', 'minutes', 'views', 'youtube', 'instagram']) assert.equal(weeks.reduce((sum, row) => sum + row[key], 0), report.totals[key]);
});

test('missing reports and duplicate days never silently become zero traffic', () => {
  const input = {from: '2026-07-01', to: '2026-07-02', entries: []};
  assert.throws(() => buildInsights({...input, traffic: [trafficReport('2026-07-01', '2026-07-01')]}), /неполная/);
  const single = trafficReport('2026-07-01', '2026-07-02');
  assert.throws(() => buildInsights({...input, traffic: [single, single]}), /пересекаются/);
  single.totals.page_views = 17;
  assert.throws(() => validateTrafficReport(single, input), /не совпадают/);
  assert.throws(() => validateTrafficReport(trafficReport('2026-07-01', '2026-07-02'), {from: '2026-07-01', to: '2026-07-03'}));
});

test('invalid earnings are rejected and no-performance hourly rate stays unavailable', () => {
  const input = {from: '2026-07-01', to: '2026-07-01', traffic: [trafficReport('2026-07-01', '2026-07-01')]};
  const entry = earning('2026-07-01');
  assert.throws(() => buildInsights({...input, entries: [entry, entry]}));
  assert.throws(() => buildInsights({...input, entries: [{...entry, czkMinor: -1}]}));
  assert.throws(() => buildInsights({...input, entries: [{...entry, minutes: 0}]}));
  assert.equal(buildInsights({...input, entries: []}).totals.hourCzk, null);
  assert.equal(buildInsights({...input, entries: [earning('2026-07-01', 'a', '0')]}).totals.hourCzk, 0);
});

test('chart scales start at zero and contain zero, fractional and large amounts', () => {
  for (const values of [[0], [.02], [444, 853], [1234567.89]]) {
    const scale = axisScale(values);
    assert.equal(scale.ticks[0], 0);
    assert.ok(scale.max >= Math.max(...values));
    assert.ok(scale.ticks.every(Number.isFinite));
  }
  assert.ok(axisScale([0, 1, 3], true).ticks.every(Number.isInteger));
});
