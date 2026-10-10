import {plusDays, validateEntry, convert} from '../../statistics-panel/earnings-model.js';

export function trafficReport(from, to, views = 8) {
  const daily = [];
  for (let date = from; date <= to; date = plusDays(date, 1)) {
    daily.push({date, page_views: views, sessions: 6, outbound_clicks: 3, youtube: 1, instagram: 2});
  }
  const n = daily.length;
  return {version: 1, generated_at: '2026-10-09T20:00:00Z', range: {from, to, source: 'all', time_zone: 'UTC'},
    daily, totals: {page_views: views * n, sessions: 6 * n, outbound_clicks: 3 * n, youtube: n, instagram: 2 * n, converted_sessions: 2 * n},
    sources: {qr: views * n, direct: 0}, destinations: {instagram_only: n, youtube_only: 0, both: n}};
}

export function earning(date, id = date, czk = '220', start = '14:00', end = '16:00') {
  const snapshot = {requestedDate: date, rates: {CZK: 1, EUR: 25, USD: 20}};
  const entry = validateEntry({date, start, end, nextDay: false, spotId: 'spot-a',
    amounts: [{currency: 'CZK', amount: czk}, {currency: 'EUR', amount: '0'}, {currency: 'USD', amount: '0'}]}, Date.parse('2027-01-01T00:00:00Z'));
  return {...entry, ...convert(entry.amounts, snapshot), id, version: 1, snapshot};
}
