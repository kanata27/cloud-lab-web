import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTrafficReport, loadEarningsEntries} from '../statistics-panel/report-loader.js';
import {validateDateRange} from '../statistics-panel/date-filter.js';
import {buildInsights} from '../statistics-panel/insights-model.js';
import {trafficReport, earning} from './support/insights-fixtures.mjs';

test('multi-year reports merge every day and metric without exceeding three concurrent 90-day reads', async () => {
  const range = {from: '2024-01-01', to: '2026-10-18', source: 'qr'}, calls = [];
  let active = 0, peak = 0;
  const report = await loadTrafficReport(range, async query => {
    calls.push(query); active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    const data = trafficReport(query.from, query.to);
    data.range.source = query.source;
    return data;
  });
  const days = validateDateRange(range.from, range.to, range.to);
  assert.equal(report.daily.length, days);
  assert.equal(report.daily[0].date, range.from);
  assert.equal(report.daily.at(-1).date, range.to);
  assert.equal(new Set(report.daily.map(day => day.date)).size, days);
  assert.deepEqual(report.totals, {page_views: days * 8, sessions: days * 6, outbound_clicks: days * 3,
    converted_sessions: days * 2, youtube: days, instagram: days * 2});
  assert.deepEqual(report.sources, {qr: days * 8, direct: 0});
  assert.deepEqual(report.destinations, {instagram_only: days, youtube_only: 0, both: days});
  assert.equal(peak, 3);
  assert.ok(calls.every(query => query.source === 'qr' && (Date.parse(query.to) - Date.parse(query.from)) / 86400000 < 90));
  const insightTraffic = structuredClone(report); insightTraffic.range.source = 'all';
  const insights = buildInsights({...range, traffic: [insightTraffic], entries: [earning('2024-01-01'), earning('2026-10-18')]});
  assert.equal(insights.daily.length, days);
  assert.equal(insights.totals.czkMinor, 44000);
  assert.equal(insights.totals.views, days * 8);
});

test('a failed chunk cancels sibling reads and never becomes a partial report', async () => {
  const waiting = [];
  await assert.rejects(loadTrafficReport({from: '2024-01-01', to: '2026-01-01', source: 'all'}, async (query, signal) => {
    if (query.from === '2024-01-01') throw new Error('unavailable');
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => { waiting.push(query); reject(signal.reason); }, {once: true});
    });
  }), /unavailable/);
  assert.equal(waiting.length, 2);
});

test('earnings loader follows every cursor and rejects repeated pages or interrupted reads', async () => {
  const range = {from: '2024-01-01', to: '2026-10-18', spot: 'spot-a'}, calls = [];
  const result = await loadEarningsEntries(range, async query => {
    calls.push(query);
    return query.cursor ? {entries: [earning('2024-01-01', 'old')], nextCursor: null}
      : {entries: [earning('2026-10-18', 'new')], nextCursor: 'page2'};
  });
  assert.deepEqual(result.entries.map(entry => entry.id), ['new', 'old']);
  assert.deepEqual(calls, [range, {...range, cursor: 'page2'}]);
  await assert.rejects(loadEarningsEntries(range, async () => ({entries: [earning('2024-01-01')], nextCursor: 'same'})), /Список/);
  await assert.rejects(loadEarningsEntries(range, async () => ({entries: [], nextCursor: 'same'})), /полный список/);
  const request = new AbortController();
  await assert.rejects(loadEarningsEntries(range, async () => {
    request.abort();return {entries: [earning('2024-01-01')], nextCursor: 'next'};
  }, request.signal), {name: 'AbortError'});
});
